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

// Одиночный не-200 края — ещё не авария платформы. 2026-09-05 проба открыла
// карточку по одному HTTP 502 на /api/admin/posts, хотя /api/status за секунды
// до и после отвечал 200 и все остальные проверки того же прогона прошли:
// мимолётный отказ на пути Cloudflare → Railway → serve.js → backend (в т.ч.
// перезапуск упавшего backend-ребёнка под надзором serve.js длится секунды).
// Не-200 подтверждаем повторами, а тело ответа прикладываем к сигналу: по нему
// видно, ЧЬЙ это отказ (страница Cloudflare, «upstream error» супервизора,
// JSON бэкенда), и следующий разбор не начинается с нуля.
export async function checkAdminPosts(fetchImpl, base, token, { retries = 2, retryDelayMs = 5000 } = {}) {
  const attempt = async () => {
    const r = await fetchImpl(base + '/api/admin/posts?limit=1', {
      headers: { Cookie: 'svic_token=' + token },
    });
    if (r.status === 200) return { status: 200, total: Number((await r.json()).total || 0) };
    const raw = typeof r.text === 'function' ? await r.text().catch(() => '') : '';
    return { status: r.status, body: String(raw).replace(/\s+/g, ' ').trim().slice(0, 200) };
  };
  let last = await attempt();
  for (let i = 0; i < retries && last.status !== 200; i += 1) {
    await sleep(retryDelayMs);
    last = await attempt();
  }
  if (last.status !== 200) {
    const tries = retries > 0 ? ` (${retries + 1} попытки)` : '';
    const body = last.body ? ` — ответ: ${last.body}` : '';
    return `/api/admin/posts: HTTP ${last.status}${tries}${body}`;
  }
  if (last.total < 1000) return `админка: /api/admin/posts total=${last.total} — пустая выдача`;
  return null;
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
    const st = await (await fetch(ORIGIN + '/api/status')).json();
    if (!st.ok || !st.db) problems.push('origin /api/status: не ok/db');
    const ver = await fetch(ORIGIN + '/api/site/__version');
    if (ver.status !== 200) problems.push(`/api/site/__version: HTTP ${ver.status}`);
    else {
      const payload = await ver.json().catch(() => null);
      if (!payload || typeof payload.v === 'undefined') problems.push('/api/site/__version: нет JSON-поля v');
    }
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
