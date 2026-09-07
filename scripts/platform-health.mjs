#!/usr/bin/env node
// Сторож origin+админки+медиатеки. Карточка stand-platform-health, раз в час.
//
// После 26.08 origin на *.up.railway.app закрыт без служебного ключа: с улицы
// живы только /api/status. Проба ходила туда же, куда деплой-дым, и честно
// видела 404 на /api/site/__version и /api/admin/posts — публичный сайт при
// этом отвечал. Ходим по адресу посетителя. JWT платформы обязан нести
// issuer/audience, иначе подпись после 26.08 не принимается.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openTask, closeTask } from './system-task.mjs';

export const PUBLIC_ORIGIN = 'https://siliconvalleyinvestclub.com';
export const TASK_KEY = 'stand-platform-health';
export const JWT_SIGN_OPTIONS = {
  expiresIn: '10m',
  issuer: 'svic-platform',
  audience: 'svic-platform',
  algorithm: 'HS256',
};

function origin() {
  const raw = (process.env.SITE_HEALTH_ORIGIN || PUBLIC_ORIGIN).replace(/\/+$/, '');
  const host = new URL(raw).hostname.toLowerCase();
  if (host.endsWith('.up.railway.app')) {
    throw new Error('проба здоровья ходит на закрытый Railway-адрес, а не на публичный сайт');
  }
  return raw;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Тело читается как текст, JSON — только если оно на него похоже. 2026-09-07
// проба открыла карточку «health-пробы упали: Unexpected token '<', "<!DOCTYPE"»
// потому что /api/status парсился слепо: край на секунды отдал HTML (страница
// Cloudflare / Next), JSON.parse бросил, и разбор начинался с синтаксической
// ошибки вместо названного отказа. Тот же класс, что 05.09 закрыли только на
// не-200 /api/admin/posts. HTML/5xx/битый JSON подтверждаем повторами.
export async function readJsonResponse(response) {
  const status = Number(response && response.status) || 0;
  let contentType = '';
  try {
    if (response && response.headers && typeof response.headers.get === 'function') {
      contentType = String(response.headers.get('content-type') || '');
    }
  } catch (_) { /* mock without headers */ }
  let raw = '';
  if (response && typeof response.text === 'function') {
    raw = String(await response.text().catch(() => '') || '');
  } else if (response && typeof response.json === 'function') {
    try { raw = JSON.stringify(await response.json()); } catch (_) { raw = ''; }
  }
  const snippet = raw.replace(/\s+/g, ' ').trim().slice(0, 200);
  const html = /html/i.test(contentType) || /^\s*</.test(raw);
  if (html) return { status, kind: 'html', snippet, payload: null };
  if (/^\s*[{[]/.test(raw)) {
    try {
      return { status, kind: 'json', snippet, payload: JSON.parse(raw) };
    } catch (_) {
      return { status, kind: 'invalid_json', snippet, payload: null };
    }
  }
  return { status, kind: 'non_json', snippet, payload: null };
}

function describeJsonFailure(label, read, { retries = 0 } = {}) {
  const tries = retries > 0 ? ` (${retries + 1} попытки)` : '';
  const why = read.kind === 'html' ? ' HTML вместо JSON'
    : (read.kind === 'invalid_json' || read.kind === 'non_json' ? ' не JSON' : '');
  const body = read.snippet ? ` — ответ: ${read.snippet}` : '';
  return `${label}: HTTP ${read.status}${why}${tries}${body}`;
}

async function confirmJson(fetchImpl, url, {
  headers,
  retries = 2,
  retryDelayMs = 5000,
  ok = (payload, status) => status === 200 && payload && typeof payload === 'object',
} = {}) {
  const attempt = async () => readJsonResponse(await fetchImpl(url, headers ? { headers } : undefined));
  let last = await attempt();
  const good = (read) => read.kind === 'json' && ok(read.payload, read.status);
  for (let i = 0; i < retries && !good(last); i += 1) {
    await sleep(retryDelayMs);
    last = await attempt();
  }
  return { last, good: good(last) };
}

// Одиночный не-200 края — ещё не авария платформы. 2026-09-05 проба открыла
// карточку по одному HTTP 502 на /api/admin/posts, хотя /api/status за секунды
// до и после отвечал 200 и все остальные проверки того же прогона прошли:
// мимолётный отказ на пути Cloudflare → Railway → serve.js → backend (в т.ч.
// перезапуск упавшего backend-ребёнка под надзором serve.js длится секунды).
// Не-200 подтверждаем повторами, а тело ответа прикладываем к сигналу: по нему
// видно, ЧЬЙ это отказ (страница Cloudflare, «upstream error» супервизора,
// JSON бэкенда), и следующий разбор не начинается с нуля.
export async function checkAdminPosts(fetchImpl, base, token, { retries = 2, retryDelayMs = 5000 } = {}) {
  const { last, good } = await confirmJson(fetchImpl, base + '/api/admin/posts?limit=1', {
    headers: { Cookie: 'svic_token=' + token },
    retries,
    retryDelayMs,
    ok: (payload, status) => status === 200 && payload && typeof payload === 'object',
  });
  if (!good) {
    // Формат не-200 без «HTML вместо JSON» — контракт теста 05.09.
    if (last.status !== 200) {
      const tries = retries > 0 ? ` (${retries + 1} попытки)` : '';
      const body = last.snippet && last.kind !== 'json' ? ` — ответ: ${last.snippet}` : '';
      return `/api/admin/posts: HTTP ${last.status}${tries}${body}`;
    }
    return describeJsonFailure('/api/admin/posts', last, { retries });
  }
  const total = Number(last.payload.total || 0);
  if (total < 1000) return `админка: /api/admin/posts total=${total} — пустая выдача`;
  return null;
}

export async function checkOriginStatus(fetchImpl, base, { retries = 2, retryDelayMs = 5000 } = {}) {
  const { last, good } = await confirmJson(fetchImpl, base + '/api/status', {
    retries,
    retryDelayMs,
    ok: (payload, status) => status === 200 && payload && payload.ok && payload.db,
  });
  if (good) return null;
  if (last.kind === 'json' && last.status === 200) return 'origin /api/status: не ok/db';
  return describeJsonFailure('/api/status', last, { retries });
}

export async function checkSiteVersion(fetchImpl, base, { retries = 2, retryDelayMs = 5000 } = {}) {
  const { last, good } = await confirmJson(fetchImpl, base + '/api/site/__version', {
    retries,
    retryDelayMs,
    ok: (payload, status) => status === 200 && payload && typeof payload.v !== 'undefined',
  });
  if (good) return null;
  if (last.status !== 200 && last.kind !== 'html' && last.kind !== 'invalid_json' && last.kind !== 'non_json') {
    return `/api/site/__version: HTTP ${last.status}`;
  }
  if (last.kind === 'json' && last.status === 200) return '/api/site/__version: нет JSON-поля v';
  return describeJsonFailure('/api/site/__version', last, { retries });
}

async function main() {
  const { default: pg } = await import('pg');
  const ORIGIN = origin();
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const problems = [];
  try {
    const statusProblem = await checkOriginStatus(fetch, ORIGIN);
    if (statusProblem) problems.push(statusProblem);
    const versionProblem = await checkSiteVersion(fetch, ORIGIN);
    if (versionProblem) problems.push(versionProblem);
    if (process.env.PLATFORM_SESSION_SECRET) {
      const { default: jwt } = await import('jsonwebtoken');
      const tok = jwt.sign(
        { userId: 1, telegramUsername: 'sensor', displayName: 'sensor', role: 'admin' },
        process.env.PLATFORM_SESSION_SECRET,
        JWT_SIGN_OPTIONS,
      );
      const admin = await checkAdminPosts(fetch, ORIGIN, tok);
      if (admin) problems.push(admin);
    }
  } catch (e) { problems.push('health-пробы упали: ' + e.message); }

  // ХРАНИЛИЩЕ МЕДИАТЕКИ ОТВЕЧАЕТ (2026-08-15). 15 августа AWS закрыл аккаунт по
  // исчерпанию кредитов — картинки и видео пропали со всего сайта, и заметил это
  // Артур по скриншоту, а не мы. Проба берёт ЖИВУЮ картинку с главной и требует
  // настоящие байты: молчащее хранилище (умерший ключ, закрытый аккаунт, пустой
  // бакет) теперь становится задачей в тот же час.
  try {
    const { rows } = await pool.query(
      `SELECT coalesce(cdn_url, source_url) u FROM media WHERE mime LIKE 'image/%' ORDER BY id DESC LIMIT 3`);
    for (const { u } of rows) {
      if (!u || !u.startsWith('/')) continue;
      const r = await fetch('https://siliconvalleyinvestclub.com' + u + (u.includes('?') ? '&' : '?') + 'probe=' + Date.now(),
        { redirect: 'follow' });
      const buf = r.ok ? await r.arrayBuffer() : null;
      if (!r.ok || !buf || buf.byteLength < 512 || !String(r.headers.get('content-type') || '').startsWith('image/')) {
        problems.push(`хранилище картинок не отдаёт файл: ${u} (HTTP ${r.status}, ${buf ? buf.byteLength : 0} байт)`);
        break;
      }
    }
  } catch (e) { problems.push('проверка хранилища картинок упала: ' + e.message); }

  // контент на месте: у опубликованной статьи обязан быть чистый текст
  // (content_html). С 21.08 страницу собирает родной шаблон из него —
  // колонка снимка full_html намеренно пуста (выход из WordPress,
  // svic-platform миграции 0037/0038). До 22.08 проба мерила снимок и
  // краснела на всех 1269 статьях при живом сайте.
  try {
    const { rows } = await pool.query(`SELECT count(*)::int c FROM posts WHERE status='publish' AND (content_html IS NULL OR content_html='')`);
    if (rows[0].c > 0) problems.push(`${rows[0].c} опубликованных статей без текста страницы`);
  } catch (e) { problems.push('проверка текстов статей упала: ' + e.message); }

  try {
    const { rows } = await pool.query(
      `SELECT slug, published_at FROM posts WHERE status='publish' AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 1`);
    const newest = rows[0];
    if (newest) {
      const d = new Date(newest.published_at);
      const url = `https://siliconvalleyinvestclub.com/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${newest.slug}/`;
      const r = await fetch(url, { redirect: 'follow' });
      if (r.status !== 200) problems.push(`страница свежей статьи не открывается: ${url} (HTTP ${r.status})`);
    }
  } catch (e) { problems.push('живая проба статьи упала: ' + e.message); }

  if (problems.length) {
    await openTask({
      key: TASK_KEY,
      summary: `Платформа отвечает не так, как должна: ${problems[0]}${problems.length > 1 ? ` (и ещё ${problems.length - 1})` : ''}`,
      details: problems.join('\n'),
      instructions: 'Разобраться, почему проба здоровья платформы не проходит, устранить причину и дождаться зелёной пробы.',
    });
  } else {
    await closeTask(TASK_KEY, 'Проба здоровья платформы снова зелёная.');
  }
  try {
    await pool.query("INSERT INTO audit_log (actor, action, entity_type, after) VALUES ('daemon:platform-health','daemon.run','daemon:platform-health',$1)",
      [JSON.stringify({ status: problems.length ? 'warn' : 'ok', problems })]);
  } catch {}
  await pool.end();
  console.log(problems.length ? '⚠️ ' + problems.join(' | ') : '✅ платформа здорова');
  if (problems.length) process.exitCode = 1;
}

const isMain = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main();
