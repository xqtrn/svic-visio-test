#!/usr/bin/env node
/**
 * remux-uploads.mjs — оптимизатор видео, загруженных из админки test-стенда.
 *
 * Аплоады из редактора уходят в S3 (videos/u<ts36>-<slug>.mp4) как есть; без
 * faststart (moov в хвосте) iPhone стартует ролик с задержкой/стопорится.
 * Демон ежечасно: список аплоадов (префикс videos/u) → кто ещё не обработан
 * (audit_log action='daemon.remux') → lossless `ffmpeg -c copy +faststart` →
 * PUT обратно → отчёт per-файл + сводка daemon.run (админка показывает работу).
 *
 * env: DATABASE_URL, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION, S3_BUCKET
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import pg from 'pg';

const AK = process.env.S3_ACCESS_KEY_ID, SK = process.env.S3_SECRET_ACCESS_KEY;
const REGION = process.env.S3_REGION || 'us-east-1';
const BUCKET = process.env.S3_BUCKET || 'svic-video-archive';
const HOST = `${BUCKET}.s3.${REGION}.amazonaws.com`;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// SigV4: presigned URL (GET/PUT, SignedHeaders=host) — тот же приём, что backend/src/lib/s3sign.js
function presign(method, key, query = '') {
  const amz = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amz.slice(0, 8);
  const scope = `${date}/${REGION}/s3/aws4_request`;
  const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const uri = '/' + key.split('/').filter(Boolean).map(enc).join('/');
  const q = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${AK}/${scope}`,
    'X-Amz-Date': amz,
    'X-Amz-Expires': '900',
    'X-Amz-SignedHeaders': 'host',
  };
  for (const part of query.split('&').filter(Boolean)) {
    const [k, v = ''] = part.split('=');
    q[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  const cq = Object.keys(q).sort().map((k) => `${enc(k)}=${enc(q[k])}`).join('&');
  const creq = `${method}\n${uri || '/'}\n${cq}\nhost:${HOST}\n\nhost\nUNSIGNED-PAYLOAD`;
  const hash = (x) => crypto.createHash('sha256').update(x).digest('hex');
  const sts = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${hash(creq)}`;
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
  const kS = hmac(hmac(hmac(hmac('AWS4' + SK, date), REGION), 's3'), 'aws4_request');
  const sig = crypto.createHmac('sha256', kS).update(sts).digest('hex');
  return `https://${HOST}${uri || '/'}?${cq}&X-Amz-Signature=${sig}`;
}

// список аплоадов админки (id начинаются с 'u': см. /api/admin/video/presign)
const listUrl = presign('GET', '/', 'list-type=2&prefix=videos/u');
const xml = await (await fetch(listUrl)).text();
// только формат админ-аплоада u<ts36>-<slug> (см. /api/admin/video/presign);
// легаси-ролики с YouTube-id на 'u' (11 симв., без такого дефиса) — НЕ наши
const keys = [...xml.matchAll(/<Key>(videos\/u[a-z0-9]{6,10}-[A-Za-z0-9_-]{1,12}\.mp4)<\/Key>/g)].map((m) => m[1]);
console.log(`[list] ${keys.length} admin upload(s) in bucket`);

const done = new Set(
  (await pool.query(`SELECT entity_type FROM audit_log WHERE action = 'daemon.remux'`)).rows.map((r) => r.entity_type)
);
const pending = keys.filter((k) => !done.has('video:' + k.slice('videos/'.length, -4)));
console.log(`[pending] ${pending.length}`);

let remuxed = 0, failed = 0;
for (const key of pending) {
  const id = key.slice('videos/'.length, -4);
  try {
    const src = await fetch(presign('GET', key));
    if (!src.ok) throw new Error('GET ' + src.status);
    fs.writeFileSync('in.mp4', Buffer.from(await src.arrayBuffer()));
    execSync('ffmpeg -y -i in.mp4 -c copy -movflags +faststart out.mp4', { stdio: 'pipe' });
    const out = fs.readFileSync('out.mp4');
    const put = await fetch(presign('PUT', key), { method: 'PUT', body: out, headers: { 'Content-Type': 'video/mp4' } });
    if (!put.ok) throw new Error('PUT ' + put.status);
    await pool.query(
      `INSERT INTO audit_log (actor, action, entity_type, after) VALUES ('daemon:video-remux','daemon.remux',$1,$2)`,
      ['video:' + id, JSON.stringify({ status: 'ok', bytes_in: fs.statSync('in.mp4').size, bytes_out: out.length })]);
    remuxed++;
    console.log(`[remux] ${id}: faststart ok (${out.length}b)`);
  } catch (e) {
    failed++;
    const detail = ((e.stderr || e.stdout || '').toString().trim().split('\n').pop() || e.message).slice(0, 300);
    console.warn(`[remux] ${id} FAIL: ${detail}`);
    // фейл тоже фиксируем, чтобы не долбить битый файл каждый час; переснимется при перезаливке
    await pool.query(
      `INSERT INTO audit_log (actor, action, entity_type, after) VALUES ('daemon:video-remux','daemon.remux',$1,$2)`,
      ['video:' + id, JSON.stringify({ status: 'fail', error: ((e.stderr || '').toString().trim().split('\n').pop() || e.message).slice(0, 200) })]).catch(() => {});
  }
}

await pool.query(
  `INSERT INTO audit_log (actor, action, entity_type, after) VALUES ('daemon:video-remux','daemon.run','daemon:video-remux',$1)`,
  [JSON.stringify({ status: failed ? 'warn' : 'ok', uploads: keys.length, remuxed, failed })]);
await pool.end();
console.log(`[done] remuxed=${remuxed} failed=${failed}`);
