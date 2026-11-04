#!/usr/bin/env node
/* Ролик статьи доезжает до сайта сам (Артур 2026-07-28: «видео Андурил всё равно нет»).
 *
 * Ручная статья несёт ссылку на YouTube (seo_meta.video_id). Карточке и странице
 * нужен файл на нашем домене — /svic-video/<id>.mp4. Раньше такие файлы копил
 * релиз в этом репозитории, но у релиза GitHub жёсткий потолок в 1000 активов, и
 * он давно выбран: новые ролики просто НЕ загружались, а прогон при этом
 * заканчивался зелёным. Поэтому копия кладётся туда же, куда кладёт админка при
 * ручной загрузке файла, — в наше хранилище (videos/<id>.mp4).
 *
 * Проверка «есть ли уже» идёт по живому адресу сайта, а не по хранилищу: так
 * зачитывается и релиз, и хранилище, и не нужны ключи на чтение.
 */
import pg from 'pg';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { ytId, probeVerdict, probeIsBlind } from './scripts/archive-clips-lib.mjs';

const HOST = process.env.SVIC_HOST || 'https://siliconvalleyinvestclub.com';
const PLAN_ONLY = process.argv.includes('--plan');
const BUCKET = process.env.S3_BUCKET || 'svic-media';
const PROXY = process.env.PENGUIN_SOCKS || '';
const LIMIT = Number(process.env.MAX_CLIPS || 5);   // за один прогон, чтобы не жечь минуты

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const rows = (await db.query(
  `SELECT id, slug, title, seo_meta->>'video_id' vid FROM posts
   WHERE status='publish' AND seo_meta->>'video_id' <> '' ORDER BY published_at DESC LIMIT 200`)).rows;
await db.end();

const wanted = [];
const checked = new Set();
const unknown = [];
for (const r of rows) {
  const id = ytId(r.vid);
  if (!id || checked.has(id)) continue;
  checked.add(id);
  const probe = await fetch(`${HOST}/svic-video/${id}.mp4`, { method: 'GET', headers: { Range: 'bytes=0-1' } }).catch(() => null);
  const verdict = probeVerdict(probe?.status, probe?.headers?.get('content-type'));
  await probe?.body?.cancel().catch(() => {});
  if (verdict === 'missing') wanted.push({ id, slug: r.slug, title: r.title });
  if (verdict === 'unknown') unknown.push(`${id}: ${probe?.status ?? 'нет ответа'}`);
}
console.log(`статей с роликом: ${rows.length} · с YouTube: ${checked.size} · без файла на сайте: ${wanted.length} · не удалось проверить: ${unknown.length}`);
if (unknown.length) console.error(`сайт не ответил про файл: ${unknown.slice(0, 5).join(', ')}`);
// Проба, которая не видит сайт, не имеет права объявлять ролики пропавшими и
// заходить в загрузку: с 2026-09-10 такой слепой пробой робот считал пропавшими все.
if (probeIsBlind(unknown.length, checked.size)) {
  console.error(`проверка файлов на ${HOST} не работает: ответ получен меньше чем про половину`);
  process.exit(1);
}
if (PLAN_ONLY) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `missing=${wanted.length}\n`);
  process.exit(0);
}
if (!wanted.length) { console.log('✓ все ролики на месте'); process.exit(0); }

// Хранилище — Cloudflare R2 (2026-08-15): S3-совместимо, адрес путём, регион «auto».
// Пустой S3_ENDPOINT → классический AWS.
const s3 = new S3Client({
  region: process.env.S3_REGION || 'auto',
  ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}),
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
});

let ok = 0, fail = 0;
for (const w of wanted.slice(0, LIMIT)) {
  console.log(`=== ${w.id} · ${w.title.slice(0, 60)}`);
  try {
    fs.rmSync('in.mp4', { force: true }); fs.rmSync('out.mp4', { force: true });
    execSync(`yt-dlp --no-playlist --no-progress --no-warnings --js-runtimes node ${PROXY ? `--proxy "${PROXY}"` : ''} `
      + `--extractor-args "youtube:player_client=web_safari,tv_samsung,visionos,android_vr,tv_simply" `
      + `-f 'b[height<=720][ext=mp4]/bv*[height<=720]+ba/b[height<=720]/b' --merge-output-format mp4 `
      + `-o in.mp4 "https://www.youtube.com/watch?v=${w.id}"`, { stdio: 'inherit', shell: '/bin/bash' });
    // faststart: без него iOS ждёт весь файл перед первым кадром
    execSync('ffmpeg -hide_banner -loglevel error -i in.mp4 -c copy -movflags +faststart out.mp4'
      + ' || ffmpeg -hide_banner -loglevel error -i in.mp4 -c:v libx264 -preset veryfast -crf 23 -c:a aac -movflags +faststart out.mp4',
      { stdio: 'inherit', shell: '/bin/bash' });
    const body = fs.readFileSync('out.mp4');
    if (body.length < 50000) throw new Error(`слишком мелкий файл: ${body.length} байт`);
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `videos/${w.id}.mp4`, Body: body, ContentType: 'video/mp4' }));
    console.log(`   → загружено ${(body.length / 1048576).toFixed(1)} МБ в videos/${w.id}.mp4`);
    ok++;
  } catch (e) { console.error(`   ✗ ${e.message}`); fail++; }
}
console.log(`итог: загружено ${ok}, не вышло ${fail}, осталось в очереди ${Math.max(0, wanted.length - LIMIT)}`);
process.exit(fail && !ok ? 1 : 0);
