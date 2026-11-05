#!/usr/bin/env node
// Сторож origin+админки+медиатеки. Карточка stand-platform-health, раз в час.
//
// После 26.08 origin на *.up.railway.app закрыт без служебного ключа: с улицы
// живы только /api/status. Проба ходила туда же, куда деплой-дым, и честно
// видела 404 на /api/site/__version и /api/admin/posts — публичный сайт при
// этом отвечал. Ходим по адресу посетителя. JWT платформы обязан нести
// issuer/audience, иначе подпись после 26.08 не принимается.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openTask, closeTask } from './system-task.mjs';

export const PUBLIC_ORIGIN = 'https://siliconvalleyinvestclub.com';
export const TASK_KEY = 'stand-platform-health';
export const ROBOT_DB_TASK_KEY = 'stand-robot-db-secret-stale';
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
const CMS_AUTH_ERRORS = new Set(['auth_required', 'admin_only', 'Not authenticated', 'Access denied']);

export function isCmsAuthRejection(read) {
  if (!read || (read.status !== 401 && read.status !== 403)) return false;
  if (read.kind !== 'json' || !read.payload || typeof read.payload !== 'object') return false;
  const err = String(read.payload.error || '');
  return CMS_AUTH_ERRORS.has(err) || /auth_required|admin_only/i.test(err);
}

export async function checkAdminPosts(fetchImpl, base, token, { retries = 2, retryDelayMs = 5000 } = {}) {
  const { last, good } = await confirmJson(fetchImpl, base + '/api/admin/posts?limit=1', {
    headers: { Cookie: 'svic_token=' + token },
    retries,
    retryDelayMs,
    ok: (payload, status) => status === 200 && payload && typeof payload === 'object',
  });
  if (!good) {
    // 2026-10-23: копия PLATFORM_SESSION_SECRET в GitHub visio-test разошлась
    // с PLATFORM_AUTH_SECRET сайта. Маршрут жив и отвечает JSON auth_required —
    // это отказ датчика, не падение CMS. 404 = маршрут потерян; 5xx/HTML = край.
    if (isCmsAuthRejection(last)) return null;
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

// SVIC_PLATFORM_DATABASE_URL обязан быть базой CMS (svic_platform), не
// автоматизации. 2026-10-23 секрет перезаписали адресом платформы: проба
// честно видела «relation posts/media does not exist» при живом сайте.
export async function assertCmsSchema(pool) {
  if (!pool || typeof pool.query !== 'function') {
    return 'проба не получила подключение к базе CMS';
  }
  try {
    const { rows } = await pool.query(`
      SELECT current_database() AS db,
             to_regclass('public.posts') IS NOT NULL AS has_posts,
             to_regclass('public.media') IS NOT NULL AS has_media
    `);
    const row = rows[0] || {};
    if (row.has_posts && row.has_media) return null;
    return `секрет SVIC_PLATFORM_DATABASE_URL указывает не на базу CMS (database=${row.db}, posts=${row.has_posts}, media=${row.has_media})`;
  } catch (error) {
    return 'не удалось проверить схему CMS: ' + error.message;
  }
}

// Скопированный SVIC_PLATFORM_DATABASE_URL расходится с паролем живого пула
// (2026-10-23: секрет от 01:43Z был зелёным в 01:48Z и с 02:41Z давал
// password authentication failed, сайт при этом отвечал db:true). Схему
// считает процесс CMS и отдаёт её внутренним ключом.
export async function readLiveCmsSchema(fetchImpl, origin, internalKey) {
  if (!internalKey) return { reachable: false, reason: 'нет внутреннего ключа' };
  const url = String(origin || '').replace(/\/+$/, '') + '/api/internal/cms-schema-probe';
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { 'x-internal-key': internalKey, accept: 'application/json' },
    });
  } catch (error) {
    return { reachable: false, reason: error.message };
  }
  const read = await readJsonResponse(response);
  if (read.status === 404 || read.kind === 'html') {
    return { reachable: false, reason: 'маршрут схемы CMS недоступен' };
  }
  const payload = read.payload && typeof read.payload === 'object' ? read.payload : {};
  if (read.status === 200 && payload.ok && payload.has_posts && payload.has_media) {
    return { reachable: true, ok: true, payload };
  }
  if (read.kind !== 'json') return { reachable: false, reason: 'ответ схемы CMS не JSON' };
  return {
    reachable: true,
    ok: false,
    reason: payload.reason || `схема CMS не подтверждена живым процессом (HTTP ${read.status})`,
  };
}

async function articlePageProblem(fetchImpl, newest) {
  if (!newest || !newest.slug || !newest.published_at) return null;
  const published = new Date(newest.published_at);
  if (Number.isNaN(published.getTime())) return 'живая проба статьи упала: нет даты публикации';
  const url = `https://siliconvalleyinvestclub.com/${published.getUTCFullYear()}/${String(published.getUTCMonth() + 1).padStart(2, '0')}/${String(published.getUTCDate()).padStart(2, '0')}/${newest.slug}/`;
  const response = await fetchImpl(url, { redirect: 'follow' });
  if (response.status !== 200) return `страница свежей статьи не открывается: ${url} (HTTP ${response.status})`;
  return null;
}

async function cmsProblemsFromPool(pool, fetchImpl, origin) {
  const schemaProblem = await assertCmsSchema(pool);
  if (schemaProblem) return [schemaProblem];
  const problems = [];
  try {
    const { rows } = await pool.query(
      `SELECT coalesce(cdn_url, source_url) u FROM media WHERE mime LIKE 'image/%' ORDER BY id DESC LIMIT 3`);
    const mediaProblem = await checkRecentMedia(fetchImpl, origin, rows.map((row) => row.u));
    if (mediaProblem) problems.push(mediaProblem);
  } catch (error) { problems.push('проверка хранилища картинок упала: ' + error.message); }
  try {
    const { rows } = await pool.query(`SELECT count(*)::int c FROM posts WHERE status='publish' AND (content_html IS NULL OR content_html='')`);
    if (rows[0].c > 0) problems.push(`${rows[0].c} опубликованных статей без текста страницы`);
  } catch (error) { problems.push('проверка текстов статей упала: ' + error.message); }
  try {
    const { rows } = await pool.query(
      `SELECT slug, published_at FROM posts WHERE status='publish' AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 1`);
    const article = await articlePageProblem(fetchImpl, rows[0]);
    if (article) problems.push(article);
  } catch (error) { problems.push('живая проба статьи упала: ' + error.message); }
  return problems;
}

// Сайту копия пароля не нужна, а роботам archive-clips и events нужна. Когда она
// устарела 2026-10-23, эта проба перестала считать её поломкой сайта (и верно),
// но и никому не сказала: робот лежал 12 дней. Своя карточка, не про здоровье сайта.
export async function robotDbSecretError(pool) {
  try {
    await pool.query('SELECT 1');
    return null;
  } catch (error) {
    const stale = error?.code === '28P01' || /password authentication failed/i.test(String(error?.message));
    return stale ? String(error.message) : null;
  }
}

// Красный прогон GitHub никому не докладывает: archive-clips падал 8 недель, faces 13,
// company-news почти 4, и никто этого не видел. Поэтому та же ежечасная проба смотрит
// на все расписания репозитория. Одиночный сбой не повод: нужны два падения подряд
// на отрезке не короче 12 часов (хватает и получасовому, и недельному расписанию).
const RED_MIN_SPAN_MS = 12 * 3600 * 1000;
const ROBOT_RUNS_PER_CHECK = 30;

export function redStreak(runs, minSpanMs = RED_MIN_SPAN_MS) {
  const real = (runs || []).filter((r) => !['cancelled', 'skipped', 'neutral'].includes(r.conclusion));
  let n = 0;
  while (n < real.length && ['failure', 'timed_out'].includes(real[n].conclusion)) n += 1;
  if (n < 2) return null;
  if (Date.parse(real[0].created_at) - Date.parse(real[n - 1].created_at) < minSpanMs) return null;
  return { count: n, since: real[n - 1].created_at, url: real[0].html_url, atLeast: n === real.length && runs.length >= ROBOT_RUNS_PER_CHECK };
}

export function scheduledWorkflowFiles(dir = '.github/workflows') {
  return fs.readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f) && /^\s+schedule:\s*$/m.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    .sort();
}

export const robotTaskKey = (file) => 'stand-robot-schedule-' + file.replace(/\.ya?ml$/, '');

export function robotCard(file, streak) {
  const name = file.replace(/\.ya?ml$/, '');
  const since = new Date(streak.since).toLocaleDateString('ru-RU', { timeZone: 'America/Los_Angeles' });
  const from = (streak.atLeast ? 'как минимум с ' : 'с ') + since;
  const count = (streak.atLeast ? 'не меньше ' : '') + streak.count;
  return {
    key: robotTaskKey(file),
    summary: `Робот ${name} падает ${from}, плановых прогонов подряд: ${count}`,
    ownerBrief: `Фоновый робот сайта «${name}» не работает ${from}. Причину разбирает исполнитель.`,
    details: `Последнее падение: ${streak.url}`,
    instructions: 'Прочитать лог последнего падения, назвать причину, починить там, где она рождается, и дождаться зелёного планового прогона: карточка закроется сама.',
  };
}

// Сбой чтения GitHub ничего не открывает и не закрывает: это не сведения о роботе.
export async function checkScheduledRobots({ files, repo, token, fetchImpl, open, close }) {
  const red = [];
  for (const file of files) {
    const url = `https://api.github.com/repos/${repo}/actions/workflows/${file}/runs?event=schedule&status=completed&per_page=${ROBOT_RUNS_PER_CHECK}`;
    let runs;
    try {
      const response = await fetchImpl(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } });
      if (!response.ok) { console.error(`[robots] ${file}: GitHub ответил ${response.status}`); continue; }
      runs = (await response.json()).workflow_runs;
    } catch (error) {
      console.error(`[robots] ${file}: ${error.message}`);
      continue;
    }
    if (!Array.isArray(runs) || !runs.length) continue;
    const streak = redStreak(runs);
    if (streak) {
      red.push(file);
      await open(robotCard(file, streak));
    } else {
      await close(robotTaskKey(file), 'Плановые прогоны робота снова зелёные.');
    }
  }
  return red;
}

export async function collectCmsProbeProblems({ live, pool, fetchImpl, origin }) {
  if (live && live.reachable && live.ok) {
    const problems = [];
    const payload = live.payload || {};
    const mediaProblem = await checkRecentMedia(fetchImpl, origin, payload.images || []);
    if (mediaProblem) problems.push(mediaProblem);
    if (Number(payload.empty_published) > 0) {
      problems.push(`${Number(payload.empty_published)} опубликованных статей без текста страницы`);
    }
    try {
      const article = await articlePageProblem(fetchImpl, payload.newest);
      if (article) problems.push(article);
    } catch (error) {
      problems.push('живая проба статьи упала: ' + error.message);
    }
    return problems;
  }
  if (live && live.reachable && !live.ok) {
    return [live.reason || 'схема CMS не подтверждена живым процессом'];
  }
  return cmsProblemsFromPool(pool, fetchImpl, origin);
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

// Cloudflare 5xx на пути к origin — не «байтов нет в бакете». 2026-09-16 проба
// открыла карточку «хранилище не отдаёт файл HTTP 522, 0 байт» по одному тику:
// объект в R2 был на месте (PNG 9 КБ), /api/status того же прогона был 200,
// а край на секунды не достучался до Railway за подписанным редиректом.
// JSON-проверки уже подтверждают не-200 повторами; медиатека ходила без них.
const MEDIA_EDGE_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);

export async function checkMediaFile(fetchImpl, origin, path, { retries = 2, retryDelayMs = 5000 } = {}) {
  const attempt = async () => {
    const url = String(origin || '').replace(/\/+$/, '')
      + path
      + (path.includes('?') ? '&' : '?')
      + 'probe=' + Date.now();
    const response = await fetchImpl(url, { redirect: 'follow' });
    const status = Number(response && response.status) || 0;
    const okStatus = Boolean(response && response.ok);
    let type = '';
    try {
      if (response && response.headers && typeof response.headers.get === 'function') {
        type = String(response.headers.get('content-type') || '');
      }
    } catch (_) { /* mock without headers */ }
    let bytes = 0;
    if (okStatus && response && typeof response.arrayBuffer === 'function') {
      const buf = await response.arrayBuffer().catch(() => null);
      bytes = buf ? buf.byteLength : 0;
    }
    return {
      ok: okStatus && bytes >= 512 && type.startsWith('image/'),
      status,
      bytes,
      type,
    };
  };
  let last = await attempt();
  for (let i = 0; i < retries && !last.ok; i += 1) {
    await sleep(retryDelayMs);
    last = await attempt();
  }
  if (last.ok) return null;
  const tries = retries > 0 ? ` (${retries + 1} попытки)` : '';
  if (MEDIA_EDGE_STATUSES.has(last.status)) {
    return `край сайта не отдал картинку: ${path} (HTTP ${last.status}${tries}, ${last.bytes} байт)`;
  }
  return `хранилище картинок не отдаёт файл: ${path} (HTTP ${last.status}${tries}, ${last.bytes} байт)`;
}

export async function checkRecentMedia(fetchImpl, origin, paths, opts) {
  for (const path of paths) {
    if (!path || !String(path).startsWith('/')) continue;
    const problem = await checkMediaFile(fetchImpl, origin, path, opts);
    if (problem) return problem;
  }
  return null;
}

async function main() {
  const { default: pg } = await import('pg');
  const ORIGIN = origin();
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  pool.on('error', () => {});
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

  // Картинки и текст статей считаются по ответу живого процесса CMS.
  // Скопированный пароль postgres остаётся только запасным путём, если маршрут
  // схемы ещё не выкачен: ошибка этого пароля не карточка, когда процесс схему
  // уже подтвердил.
  const live = await readLiveCmsSchema(fetch, ORIGIN, process.env.SVIC_INTERNAL_KEY);
  const cmsProblems = await collectCmsProbeProblems({
    live, pool, fetchImpl: fetch, origin: ORIGIN,
  });
  problems.push(...cmsProblems);

  const robotDbError = await robotDbSecretError(pool);
  if (robotDbError) {
    await openTask({
      key: ROBOT_DB_TASK_KEY,
      summary: 'Роботы сайта не могут войти в базу: устарел секрет SVIC_PLATFORM_DATABASE_URL',
      details: robotDbError,
      instructions: 'В xqtrn/svic-visio-test обновить секрет SVIC_PLATFORM_DATABASE_URL значением из переменных сервиса site-db (проект Railway svic-platform, публичный вход сервиса). Без него не работают archive-clips и events.',
    });
  } else {
    await closeTask(ROBOT_DB_TASK_KEY, 'Секрет базы у роботов снова верный.');
  }

  if (process.env.GH_TOKEN && process.env.GITHUB_REPOSITORY) {
    const red = await checkScheduledRobots({
      files: scheduledWorkflowFiles(),
      repo: process.env.GITHUB_REPOSITORY,
      token: process.env.GH_TOKEN,
      fetchImpl: fetch,
      open: openTask,
      close: closeTask,
    });
    console.log(red.length ? `роботы красные: ${red.join(', ')}` : 'все расписания в порядке');
  }

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
