#!/usr/bin/env node
/**
 * snapshot-delta.mjs — держит full_html-зеркало test-стенда свежим и следит за дрейфом.
 *
 * 1. Пере-снимает с живого WP страницы/посты, у которых снапшота нет или контент
 *    менялся после него (updated_at > full_html_at; ставит импортёр в контейнере).
 *    Правки из админки (content_edited=true) никогда не перезаписываются.
 * 2. Дрейф-сенсор: публикации на живом WP vs published-строки в БД. Расхождение
 *    (сломан делта-крон импортёра) или остаток без снапшота → ОДНО короткое
 *    TG-сообщение Артуру (delta-only: молчим, когда всё зелено).
 *
 * env: DATABASE_URL (svic_platform), TELEGRAM_BOT_TOKEN (алерты, опционально)
 */
import pg from 'pg';

const { Pool } = pg;
const ORIGIN = 'https://siliconvalleyinvestclub.com';
const TG_CHAT = '305112149'; // Артур

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /rlwy\.net|railway/.test(process.env.DATABASE_URL || '') ? { rejectUnauthorized: false } : false,
});

async function fetchHtml(slug) {
  const r = await fetch(`${ORIGIN}/${slug}/`, { headers: { 'User-Agent': 'svic-platform-snapshot/1.0' } });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.text();
}

async function snapshotTable(table) {
  const { rows } = await pool.query(
    `SELECT id, slug FROM ${table} WHERE status='publish' AND content_edited = false
     AND (full_html IS NULL OR full_html = '' OR full_html_at IS NULL OR updated_at > full_html_at) ORDER BY id`);
  let done = 0, gone = 0, fail = 0;
  const queue = [...rows];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const r = queue.shift();
      try {
        const html = await fetchHtml(r.slug);
        await pool.query(`UPDATE ${table} SET full_html = $1, full_html_at = now() WHERE id = $2`, [html, r.id]);
        done++;
      } catch (e) {
        // 404/410 = удалено/снято на живом WP; статус поправит следующий делта-импорт
        if (/^(404|410)$/.test(e.message)) gone++; else { fail++; console.warn(`[${table}] FAIL ${r.slug}: ${e.message}`); }
      }
    }
  }));
  console.log(`[${table}] need=${rows.length} done=${done} gone=${gone} fail=${fail}`);
  return { need: rows.length, done, gone, fail };
}

async function tg(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) { console.warn('[tg] no token, alert skipped:', text); return; }
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text }),
  }).catch(e => console.warn('[tg] send failed:', e.message));
}

const pagesRes = await snapshotTable('pages');
const postsRes = await snapshotTable('posts');

// Дрейф: живой WP vs БД (только posts — pages почти статичны)
const head = await fetch(`${ORIGIN}/wp-json/wp/v2/posts?per_page=1`, { headers: { 'User-Agent': 'svic-platform-snapshot/1.0' } });
const wpTotal = parseInt(head.headers.get('x-wp-total') || '0', 10);
const dbTotal = parseInt((await pool.query(`SELECT count(*)::int c FROM posts WHERE status='publish'`)).rows[0].c, 10);
console.log(`[drift] WP=${wpTotal} DB=${dbTotal}`);

const problems = [];
if (wpTotal && Math.abs(wpTotal - dbTotal) > 1) problems.push(`посты: WP ${wpTotal} vs зеркало ${dbTotal} (делта-импорт отстаёт)`);
if (postsRes.fail + pagesRes.fail > 0) problems.push(`снапшоты не снялись: ${postsRes.fail + pagesRes.fail} стр.`);
if (problems.length) await tg(`⚠️ test-стенд: зеркало WP разошлось.\n${problems.join('\n')}`);

await pool.end();
if (postsRes.fail + pagesRes.fail > 0) process.exit(1);
