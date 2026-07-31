#!/usr/bin/env node
/**
 * Event-driven pipeline for admin-uploaded videos only.
 *
 * video_assets is intentionally not backfilled. Therefore this worker cannot
 * touch legacy videos with burned-in captions: it processes only explicit rows
 * created by POST /api/admin/video/uploaded after the caption cutover.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const AK = process.env.S3_ACCESS_KEY_ID || '';
const SK = process.env.S3_SECRET_ACCESS_KEY || '';
const REGION = process.env.S3_REGION || 'us-east-1';
const BUCKET = process.env.S3_BUCKET || 'svic-video-archive';
const MODEL = process.env.WHISPER_MODEL || 'small';
const HOST = `${BUCKET}.s3.${REGION}.amazonaws.com`;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const requestedId = String(process.env.VIDEO_ID || '').replace(/[^A-Za-z0-9_-]/g, '');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function presign(method, key, expires = 900) {
  const amz = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amz.slice(0, 8);
  const scope = `${date}/${REGION}/s3/aws4_request`;
  const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const uri = '/' + key.split('/').filter(Boolean).map(enc).join('/');
  const q = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${AK}/${scope}`,
    'X-Amz-Date': amz,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const cq = Object.keys(q).sort().map((k) => `${enc(k)}=${enc(q[k])}`).join('&');
  const canonical = `${method}\n${uri}\n${cq}\nhost:${HOST}\n\nhost\nUNSIGNED-PAYLOAD`;
  const hash = (x) => crypto.createHash('sha256').update(x).digest('hex');
  const sts = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${hash(canonical)}`;
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
  const signing = hmac(hmac(hmac(hmac('AWS4' + SK, date), REGION), 's3'), 'aws4_request');
  const sig = crypto.createHmac('sha256', signing).update(sts).digest('hex');
  return `https://${HOST}${uri}?${cq}&X-Amz-Signature=${sig}`;
}

async function s3Get(key) {
  const r = await fetch(presign('GET', key));
  if (!r.ok) throw new Error(`S3 GET ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function s3Put(key, body, contentType) {
  const r = await fetch(presign('PUT', key), {
    method: 'PUT',
    body,
    headers: { 'Content-Type': contentType },
  });
  if (!r.ok) throw new Error(`S3 PUT ${r.status}`);
}

const langCode = (language) => {
  const k = String(language || '').toLowerCase();
  const map = {
    english: 'en', russian: 'ru', spanish: 'es', french: 'fr', german: 'de',
    italian: 'it', portuguese: 'pt', hindi: 'hi', japanese: 'ja',
    chinese: 'zh', ukrainian: 'uk', arabic: 'ar',
  };
  return map[k] || (/^[a-z]{2,3}(?:-[a-z0-9]+)?$/i.test(k) ? k : 'en');
};

const cueTime = (seconds) => {
  const ms = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const hh = Math.floor(ms / 3600000);
  const mm = Math.floor((ms % 3600000) / 60000);
  const ss = Math.floor((ms % 60000) / 1000);
  const mmm = ms % 1000;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(mmm).padStart(3, '0')}`;
};

function safeText(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/-->/g, '→')
    .replace(/\s+/g, ' ')
    .trim();
}

// Keep cues readable on mobile. If the recognizer returns a long segment,
// divide its time proportionally instead of rendering a four-line paragraph.
function splitSegment(segment, offset) {
  const text = safeText(segment.text);
  if (!text) return [];
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if (current && `${current} ${word}`.length > 72) {
      lines.push(current);
      current = word;
    } else {
      current += (current ? ' ' : '') + word;
    }
  }
  if (current) lines.push(current);
  const start = offset + Number(segment.start || 0);
  const end = Math.max(start + 0.6, offset + Number(segment.end || segment.start || 0));
  const totalChars = lines.reduce((n, x) => n + x.length, 0) || 1;
  let cursor = start;
  return lines.map((line, i) => {
    const slice = i === lines.length - 1
      ? end - cursor
      : (end - start) * (line.length / totalChars);
    const out = { start: cursor, end: Math.max(cursor + 0.3, cursor + slice), text: line };
    cursor = out.end;
    return out;
  });
}

function transcribeFiles(files) {
  const helper = path.join(SCRIPT_DIR, 'caption-transcribe.py');
  const raw = execFileSync(process.env.PYTHON || 'python3', [helper, ...files], {
    encoding: 'utf8',
    env: { ...process.env, WHISPER_MODEL: MODEL },
    maxBuffer: 20 * 1024 * 1024,
  });
  return JSON.parse(raw);
}

function duration(file) {
  return Number(execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ], { encoding: 'utf8' }).trim()) || 0;
}

async function audit(action, id, after) {
  await pool.query(
    `INSERT INTO audit_log (actor, action, entity_type, after)
     VALUES ('daemon:video-captions',$1,$2,$3)`,
    [action, `video:${id}`, JSON.stringify(after)]);
}

async function processAsset(asset) {
  const id = asset.id;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `svic-caption-${id}-`));
  try {
    await pool.query(
      `UPDATE video_assets SET captions_status='processing', attempts=attempts+1,
       error=NULL, updated_at=now() WHERE id=$1`,
      [id]);

    const input = path.join(tmp, 'input.mp4');
    const output = path.join(tmp, 'faststart.mp4');
    fs.writeFileSync(input, await s3Get(asset.object_key));
    execFileSync('ffmpeg', ['-y', '-i', input, '-c', 'copy', '-movflags', '+faststart', output], { stdio: 'pipe' });
    await s3Put(asset.object_key, fs.readFileSync(output), 'video/mp4');

    // Карточная копия <=720p рядом с мастером (2026-07-30): карточки главной
    // тянули 33-МБ мастер и вечно крутили спиннер на домашнем канале — у
    // архивной полосы лёгкие копии есть, у ручных загрузок не было. serve.js
    // отдаёт её по ?c=1, клип-плеер карточек просит именно её.
    try {
      const cardKey = asset.object_key.replace(/\.mp4$/i, '') + '.720.mp4';
      const probe = execFileSync('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=height',
        '-of', 'default=noprint_wrappers=1:nokey=1', output,
      ], { encoding: 'utf8' }).trim();
      const srcH = Number(probe) || 0;
      const card = path.join(tmp, 'card.mp4');
      const vf = srcH > 720 ? ['-vf', 'scale=-2:720'] : [];
      execFileSync('ffmpeg', ['-y', '-i', output, ...vf,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27',
        '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', card], { stdio: 'pipe' });
      // копия обязана быть ЛЕГЧЕ мастера, иначе она бессмысленна — кладём всегда,
      // но если вдруг вышла тяжелее (короткий и уже сжатый ролик), оставляем мастер
      const masterSize = fs.statSync(output).size;
      const cardSize = fs.statSync(card).size;
      if (cardSize < masterSize) {
        await s3Put(cardKey, fs.readFileSync(card), 'video/mp4');
        await audit('video.card-copy-ready', id, { key: cardKey, bytes: cardSize, master: masterSize });
      }
    } catch (e) {
      console.warn(`[card-copy] ${id}: ${e.message}`); // копия — не повод валить субтитры
    }

    const audioDir = path.join(tmp, 'audio');
    fs.mkdirSync(audioDir);
    execFileSync('ffmpeg', [
      '-y', '-i', output, '-vn', '-ac', '1', '-ar', '16000',
      '-codec:a', 'libmp3lame', '-b:a', '64k',
      '-f', 'segment', '-segment_time', '1200', '-reset_timestamps', '1',
      path.join(audioDir, 'part-%03d.mp3'),
    ], { stdio: 'pipe' });

    const files = fs.readdirSync(audioDir).filter((x) => x.endsWith('.mp3')).sort();
    const recognized = files.length ? transcribeFiles(files.map((x) => path.join(audioDir, x))) : [];
    let offset = 0;
    let language = 'en';
    const cues = [];
    for (let i = 0; i < files.length; i++) {
      const name = files[i];
      const file = path.join(audioDir, name);
      const result = recognized[i] || {};
      language = langCode(result.language || language);
      for (const segment of (result.segments || [])) cues.push(...splitSegment(segment, offset));
      offset += duration(file);
    }

    if (!cues.length) {
      await pool.query(
        `UPDATE video_assets SET captions_status='ready_no_speech',
         captions_key=NULL, captions_language=NULL, provider='faster-whisper', model=$2,
         error=NULL, ready_at=now(), updated_at=now() WHERE id=$1`,
        [id, MODEL]);
      await audit('video.captions-ready-no-speech', id, { status: 'ready_no_speech' });
      return;
    }

    const body = 'WEBVTT\n\n' + cues.map((c, i) =>
      `${i + 1}\n${cueTime(c.start)} --> ${cueTime(c.end)}\n${c.text}\n`).join('\n');
    const captionKey = `captions/${id}.vtt`;
    await s3Put(captionKey, Buffer.from(body, 'utf8'), 'text/vtt; charset=utf-8');
    await pool.query(
      `UPDATE video_assets SET captions_status='ready', captions_key=$2,
       captions_language=$3, provider='faster-whisper', model=$4, error=NULL,
       ready_at=now(), updated_at=now() WHERE id=$1`,
      [id, captionKey, language, MODEL]);
    await audit('video.captions-ready', id, { status: 'ready', cues: cues.length, language, key: captionKey });
  } catch (e) {
    const message = String(e.message || e).replace(/\s+/g, ' ').slice(0, 500);
    await pool.query(
      `UPDATE video_assets SET captions_status='error', error=$2, updated_at=now() WHERE id=$1`,
      [id, message]).catch(() => {});
    await audit('video.captions-failed', id, { status: 'error', error: message }).catch(() => {});
    throw e;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (!AK || !SK || !process.env.DATABASE_URL) throw new Error('pipeline credentials missing');

// Явный запуск по id (dispatch / ручной) обрабатывает ролик БЕЗУСЛОВНО:
// «ready» — не причина пропустить, диспатчат ради пересборки (карточная
// копия, обновлённые субтитры). 2026-07-30: media730 «ready» → selected=0,
// карточная копия так и не собралась.
const assets = requestedId
  ? (await pool.query(
    `SELECT id, object_key FROM video_assets WHERE id=$1`,
    [requestedId])).rows
  : (await pool.query(
    `SELECT id, object_key FROM video_assets
     WHERE captions_status IN ('processing','error') AND attempts < 5
     ORDER BY updated_at ASC LIMIT 20`)).rows;

let succeeded = 0;
let failed = 0;
for (const asset of assets) {
  try {
    await processAsset(asset);
    succeeded++;
    console.log(`[caption] ${asset.id}: ready`);
  } catch (e) {
    failed++;
    console.warn(`[caption] ${asset.id}: ${String(e.message || e).slice(0, 180)}`);
  }
}

await audit('daemon.video-captions-run', requestedId || 'batch', {
  requested_id: requestedId || null, selected: assets.length, succeeded, failed,
}).catch(() => {});
await pool.end();
console.log(`[done] selected=${assets.length} succeeded=${succeeded} failed=${failed}`);
if (failed) process.exitCode = 1;
