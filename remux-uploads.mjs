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
import { fileURLToPath, pathToFileURL } from 'node:url';

// Строку video_assets читает живой процесс CMS. Скопированный
// SVIC_PLATFORM_DATABASE_URL расходится с паролем пула: 2026-10-23 прогон
// 39944118394 (пост 3384, ролик umvkvamyk-horizontal) умер на pg.Pool
// «password authentication failed» ещё до копии .720.mp4, и Publish вечно
// отвечал 409 video_card_copy_not_ready. Тот же приём, что у сторожа схемы.

export const PUBLIC_CMS_ORIGIN = 'https://siliconvalleyinvestclub.com';

export function cmsOrigin(env = process.env) {
  const raw = String(env.CMS_ORIGIN || PUBLIC_CMS_ORIGIN).replace(/\/+$/, '');
  let host = '';
  try { host = new URL(raw).hostname.toLowerCase(); }
  catch { throw new Error('CMS_ORIGIN не адрес'); }
  if (host.endsWith('.up.railway.app')) {
    throw new Error('конвейер ходит на закрытый Railway-адрес, а не на публичный сайт');
  }
  return raw;
}

export async function cmsCall(fetchImpl, { origin, key, method, path: apiPath, body } = {}) {
  if (!key) throw new Error('pipeline credentials missing');
  const response = await fetchImpl(origin + apiPath, {
    method,
    headers: {
      'x-internal-key': key,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try { payload = JSON.parse(text); }
    catch { payload = { error: String(text).slice(0, 180) }; }
  }
  if (!response.ok) {
    const error = new Error(payload.error || `CMS HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function loadAssets(call, requestedId) {
  const apiPath = requestedId
    ? `/api/internal/video-pipeline/assets?id=${encodeURIComponent(requestedId)}`
    : '/api/internal/video-pipeline/assets';
  const payload = await call('GET', apiPath);
  return Array.isArray(payload.assets) ? payload.assets : [];
}

export async function beginAsset(call, id) {
  return call('POST', `/api/internal/video-pipeline/assets/${encodeURIComponent(id)}/begin`);
}

export async function finishAsset(call, id, body) {
  return call('POST', `/api/internal/video-pipeline/assets/${encodeURIComponent(id)}/finish`, body);
}

export async function auditAsset(call, action, id, after) {
  return call('POST', '/api/internal/video-pipeline/audit', { action, id, after });
}

const AK = process.env.S3_ACCESS_KEY_ID || '';
const SK = process.env.S3_SECRET_ACCESS_KEY || '';
const REGION = process.env.S3_REGION || 'auto';
const BUCKET = process.env.S3_BUCKET || 'svic-media';
const MODEL = process.env.WHISPER_MODEL || 'small';
// Хранилище — Cloudflare R2 (2026-08-15, AWS закрыл аккаунт по кредитам): S3-протокол,
// но адрес путём (<endpoint>/<bucket>/<key>) и регион «auto». Пустой S3_ENDPOINT → AWS.
const ENDPOINT = (process.env.S3_ENDPOINT || '').replace(/\/+$/, '');
const HOST = ENDPOINT ? new URL(ENDPOINT).host : `${BUCKET}.s3.${REGION}.amazonaws.com`;
const KEY_PREFIX = ENDPOINT ? '/' + encodeURIComponent(BUCKET) : '';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const requestedId = String(process.env.VIDEO_ID || '').replace(/[^A-Za-z0-9_-]/g, '');

function presign(method, key, expires = 900) {
  const amz = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amz.slice(0, 8);
  const scope = `${date}/${REGION}/s3/aws4_request`;
  const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const uri = KEY_PREFIX + '/' + key.split('/').filter(Boolean).map(enc).join('/');
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

async function audit(call, action, id, after) {
  await auditAsset(call, action, id, after);
}

async function processAsset(call, asset, { requireCard = false } = {}) {
  const id = asset.id;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `svic-caption-${id}-`));
  try {
    await beginAsset(call, id);

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
      /* yuvj420p (full-range) у cobalt-исходников часть аппаратных декодеров
         не рисует вовсе (2026-08-12): конверсию диапазона делает ТОЛЬКО
         scale:out_range=tv — ни -pix_fmt, ни format= тег диапазона не снимают
         (проверено ffmpeg 8.x на 4K-мастере OpenAI). */
      const vf = ['-vf', (srcH > 720 ? 'scale=-2:720:out_range=tv' : 'scale=trunc(iw/2)*2:trunc(ih/2)*2:out_range=tv') + ',format=yuv420p'];
      execFileSync('ffmpeg', ['-y', '-i', output, ...vf,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-color_range', 'tv',
        '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', card], { stdio: 'pipe' });
      // ПОТОЛОК ВЕСА КОПИИ (2026-09-26, Артур «чтобы с другими видео такого не было»):
      // карточка — беззвучный фон; копия тяжелее CARD_MAX_BYTES (Velaura 40 с
      // быстрого монтажа дала 6.3 МБ на crf 27) пережимается ОДИН раз под потолок
      // заданной скоростью потока. Та же планка у ежедневной сверки сайта.
      const CARD_MAX_BYTES = 3 * 1024 * 1024;
      if (fs.statSync(card).size > CARD_MAX_BYTES) {
        const dur = duration(output) || 30;
        const kbps = Math.max(350, Math.floor((CARD_MAX_BYTES * 8 * 0.9) / dur / 1000) - 96);
        execFileSync('ffmpeg', ['-y', '-i', output, ...vf,
          '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', kbps + 'k', '-maxrate', Math.floor(kbps * 1.2) + 'k',
          '-bufsize', (kbps * 2) + 'k', '-color_range', 'tv',
          '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', card], { stdio: 'pipe' });
        console.log(`[card-copy] ${id}: пережата под потолок, ${kbps} кбит/с`);
      }
      const masterSize = fs.statSync(output).size;
      let cardSize = fs.statSync(card).size;
      // Копия не легче мастера (короткий, уже сжатый ролик) — копией служит сам
      // мастер, если он в потолке: копия ОБЯЗАНА существовать, иначе замок
      // публикации ждёт её вечно, а сверка открывает задачу.
      let body = cardSize < masterSize ? fs.readFileSync(card) : null;
      if (!body && masterSize <= CARD_MAX_BYTES) { body = fs.readFileSync(output); cardSize = masterSize; }
      if (body) {
        await s3Put(cardKey, body, 'video/mp4');
        await audit(call, 'video.card-copy-ready', id, { key: cardKey, bytes: cardSize, master: masterSize });
      } else {
        throw new Error(`копия ${cardSize} байт не легче мастера ${masterSize} и тяжелее потолка`);
      }
    } catch (e) {
      console.warn(`[card-copy] ${id}: ${e.message}`);
      // Ночной пакет не останавливаем: субтитры остальных роликов важнее одной
      // копии. Именованный запуск (Publish ждёт именно .720.mp4) без копии —
      // красный: иначе робот зеленеет, а редактор час видит 409.
      if (requireCard) throw e;
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
      await finishAsset(call, id, { outcome: 'ready_no_speech', model: MODEL });
      await audit(call, 'video.captions-ready-no-speech', id, { status: 'ready_no_speech' });
      return;
    }

    const vtt = 'WEBVTT\n\n' + cues.map((c, i) =>
      `${i + 1}\n${cueTime(c.start)} --> ${cueTime(c.end)}\n${c.text}\n`).join('\n');
    const captionKey = `captions/${id}.vtt`;
    await s3Put(captionKey, Buffer.from(vtt, 'utf8'), 'text/vtt; charset=utf-8');
    await finishAsset(call, id, {
      outcome: 'ready', captions_key: captionKey, captions_language: language, model: MODEL,
    });
    await audit(call, 'video.captions-ready', id, { status: 'ready', cues: cues.length, language, key: captionKey });
  } catch (e) {
    const message = String(e.message || e).replace(/\s+/g, ' ').slice(0, 500);
    // Файла в складе НЕТ (ролик живёт только на YouTube — канон 31.08): это не
    // сбой, повторять нечего. Попытки исчерпываются сразу, ночной прогон его
    // больше не выбирает и не краснеет каждую ночь на одних и тех же id.
    if (/^S3 GET 404$/.test(message)) {
      await finishAsset(call, id, { outcome: 'no_source' }).catch(() => {});
      await audit(call, 'video.no-source-file', id, { key: asset.object_key }).catch(() => {});
      const err = new Error('no source file'); err.noSource = true; throw err;
    }
    await finishAsset(call, id, { outcome: 'error', error: message }).catch(() => {});
    await audit(call, 'video.captions-failed', id, { status: 'error', error: message }).catch(() => {});
    throw e;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const key = process.env.SVIC_INTERNAL_KEY || '';
  if (!AK || !SK || !key) throw new Error('pipeline credentials missing');
  const origin = cmsOrigin();
  const call = (method, apiPath, body) => cmsCall(fetch, { origin, key, method, path: apiPath, body });

  // Явный запуск по id (dispatch / ручной) обрабатывает ролик БЕЗУСЛОВНО:
  // «ready» — не причина пропустить, диспатчат ради пересборки (карточная
  // копия, обновлённые субтитры). 2026-07-30: media730 «ready» → selected=0,
  // карточная копия так и не собралась.
  const assets = await loadAssets(call, requestedId);

  // Явно названный ролик, которого робот не нашёл, — это СБОЙ, а не «успех с нулём».
  // 10.09–25.09 робот читал старую копию базы сайта (переезд 09.09), на каждую
  // загрузку отвечал selected=0 и зеленел — 15 роликов остались без лёгкой копии,
  // герой главной тянул мастер 4K. Красный запуск видно, зелёный ноль — нет.
  // 23.10 тот же ноль приходил раньше: пароль postgres не пускал даже к SELECT.
  if (requestedId && !assets.length) {
    await audit(call, 'daemon.video-captions-miss', requestedId, { requested_id: requestedId }).catch(() => {});
    console.error(`[miss] ${requestedId}: нет строки в video_assets у живого CMS`);
    process.exit(1);
  }

  let succeeded = 0;
  let failed = 0;
  for (const asset of assets) {
    try {
      await processAsset(call, asset, { requireCard: Boolean(requestedId) });
      succeeded++;
      console.log(`[caption] ${asset.id}: ready`);
    } catch (e) {
      if (e.noSource && !requestedId) { console.log(`[caption] ${asset.id}: файла нет (только YouTube) — снят с повторов`); continue; }
      failed++;
      console.warn(`[caption] ${asset.id}: ${String(e.message || e).slice(0, 180)}`);
    }
  }

  await audit(call, 'daemon.video-captions-run', requestedId || 'batch', {
    requested_id: requestedId || null, selected: assets.length, succeeded, failed,
  }).catch(() => {});
  console.log(`[done] selected=${assets.length} succeeded=${succeeded} failed=${failed}`);
  if (failed) process.exitCode = 1;
}

const isMain = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
