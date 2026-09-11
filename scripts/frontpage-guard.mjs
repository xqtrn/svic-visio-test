#!/usr/bin/env node
/* Сторож главной стенда — облачный (Артур 2026-07-28).
 *
 * Смотрит на живую выдачу siliconvalleyinvestclub.com глазами читателя и
 * проверяет два условия, которых на главной не было и которые Артур поймал сам:
 *   1) карточка принадлежит ОДНОЙ статье — заголовок, адрес и дата не могут быть
 *      от разных (класс «сшитая карточка»: фото Anduril под заголовком Humanoid);
 *   2) карточка стоит в СВОЁМ блоке — под «New Unicorn Companies» статья с тегом
 *      новых единорогов, под «Европой» европейская;
 *   3) на главной вообще есть карточки — тело страницы не должно вырождаться
 *      (28 июля сайт отдал шапку с подвалом и пустой серединой).
 * Истина о статьях — база, а не разметка.
 *
 * Молчит, пока всё в порядке. Расхождение сначала ЛЕЧИТСЯ в горле стенда
 * (POST /api/internal/frontpage-refresh heal=true) — Harvey $550M 2026-09-11
 * снова открыл карточку, потому что этот сторож после пересборки судил живую
 * HTML из tagged fetch Next на 300с и ходил на test. (уже логин), а не снимок.
 * Карточка на /developement — только если снимок после лечения всё ещё
 * расходится. Проверка снова прошла — карточка закрывается сама.
 * Секреты: SVIC_PLATFORM_DATABASE_URL, SVIC_INTERNAL_KEY.
 */
import pg from 'pg';
import { openTask, closeTask } from './system-task.mjs';

const HOST = process.env.SVIC_HOST || 'https://siliconvalleyinvestclub.com';
const API = (process.env.SVIC_API_ORIGIN || 'https://siliconvalleyinvestclub.com').replace(/\/+$/, '');
const TASK_KEY = 'stand-frontpage';
const STAND_TOKEN = process.env.STAND_TOKEN || 'edge-preview';
const PROBE_UA = 'svic-frontpage-probe';
const UNICORN_TAG = 1411;
const MIN_CARDS = 40;

const plain = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (s) => plain(s).replace(/&(?:amp|#0*38);/gi, '&').replace(/[’']/g, "'").replace(/[–—]/g, '-').toLowerCase();

function ruleOfFactory(byName) {
  return (headingRaw) => {
    const h = plain(headingRaw).toLowerCase();
    if (!h) return { type: 'latest' };
    if (h.includes('unicorn')) return { type: 'tag', id: UNICORN_TAG };
    if (byName.has(h)) return { type: 'category', id: byName.get(h) };
    return null;
  };
}

async function loadCanon(pool) {
  const posts = (await pool.query(`SELECT slug, title, categories, tags FROM posts WHERE status='publish'`)).rows;
  const bySlug = new Map(posts.map((p) => [p.slug.toLowerCase(), p]));
  const cats = (await pool.query(`SELECT wp_id, name FROM taxonomy`)).rows;
  const byName = new Map(cats.map((c) => [plain(c.name).toLowerCase(), Number(c.wp_id)]));
  const redirects = new Map((await pool.query(
    `SELECT from_path, to_path FROM redirects WHERE status_code IN (301, 302)`,
  )).rows.map((row) => [row.from_path, row.to_path]));
  return { bySlug, ruleOf: ruleOfFactory(byName), redirects };
}

function inspectHtml(html, { bySlug, ruleOf, redirects }) {
  const main = html.indexOf('<main');
  const heads = [...html.matchAll(/<(h[1-6])\b[^>]*class="[^"]*cnvs-block-section-heading[^"]*"[^>]*>([\s\S]*?)<\/\1>/g)]
    .filter((m) => m.index > main).map((m) => ({ at: m.index, text: plain(m[2]) }));
  const headingAt = (pos) => { let cur = ''; for (const h of heads) { if (h.at < pos) cur = h.text; else break; } return cur; };
  const bad = [];
  let checked = 0;
  for (const m of [...html.matchAll(/<article\b[\s\S]*?<\/article>/g)]) {
    if (m.index < main) continue;
    const card = m[0];
    const href = card.match(/href="[^"]*?\/(20\d\d)\/(\d\d)\/(\d\d)\/([^"\/]+)\/?"/);
    if (!href) continue;
    const [, y, mo, d, slug] = href;
    const path = `/${y}/${mo}/${d}/${decodeURIComponent(slug)}/`;
    const block = headingAt(m.index);
    let post = bySlug.get(decodeURIComponent(slug).toLowerCase());
    if (!post) {
      const targetPath = redirects.get(path) || redirects.get(path.replace(/\/$/, ''));
      const targetSlug = targetPath?.split('/').filter(Boolean).at(-1);
      if (targetSlug) post = bySlug.get(decodeURIComponent(targetSlug).toLowerCase());
    }
    checked++;
    if (!post) { bad.push(`${block || 'верх'}: ссылка на несуществующую статью ${path}`); continue; }
    const t = card.match(/cs-entry__title[^>]*>([\s\S]*?)<\/h[1-6]>/);
    if (t && plain(t[1]) && norm(t[1]) !== norm(post.title))
      bad.push(`${block || 'верх'}: заголовок «${plain(t[1]).slice(0, 40)}…» и ссылка ведут на разные статьи`);
    const dt = card.match(/cs-meta-date">([^<]+)</);
    if (dt && new Date(dt[1] + ' UTC').toISOString().slice(0, 10) !== `${y}-${mo}-${d}`)
      bad.push(`${block || 'верх'}: дата «${dt[1]}» расходится с адресом /${y}/${mo}/${d}/`);
    const rule = ruleOf(block);
    if (rule && rule.type === 'tag' && !(post.tags || []).map(Number).includes(rule.id))
      bad.push(`«${block}»: «${plain(post.title).slice(0, 44)}…» без тега этого блока`);
    if (rule && rule.type === 'category' && !(post.categories || []).map(Number).includes(rule.id))
      bad.push(`«${block}»: «${plain(post.title).slice(0, 44)}…» не из рубрики этого блока`);
  }
  if (checked < MIN_CARDS) bad.unshift(`на главной всего ${checked} карточек — страница выродилась`);
  return { checked, bad };
}

async function fetchHome() {
  return fetch(HOST + '/', {
    headers: {
      Cookie: 'svic_token=' + STAND_TOKEN,
      'User-Agent': PROBE_UA,
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
    redirect: 'manual',
  });
}

async function healFrontpage() {
  const key = process.env.SVIC_INTERNAL_KEY || '';
  if (!key) return { ok: false, error: 'no key' };
  try {
    const r = await fetch(API + '/api/internal/frontpage-refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': key },
      body: JSON.stringify({ heal: true }),
      signal: AbortSignal.timeout(120000),
    });
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok && body.ok === true, http: r.status, ...body };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function snapshotIsHealed(heal) {
  if (!heal || heal.ok !== true) return false;
  return !Array.isArray(heal.bad) || heal.bad.length === 0;
}

async function reportDown(status) {
  await openTask({
    key: TASK_KEY,
    summary: `Главная стенда не открывается: отвечает ${status}. Карточки не проверены.`,
    details: `GET ${HOST}/ вернул HTTP ${status} (сторож ходит с пропуском STAND_TOKEN, UA ${PROBE_UA}).`
      + (status === 403 ? ' 403 у сторожа обычно значит устаревший пропуск, а не лежащий сайт — сперва проверь секрет STAND_TOKEN.' : '')
      + (status === 302 || status === 301 ? ' Редирект на логин — это не главная; хост сторожа должен быть публичным сайтом.' : ''),
    instructions: 'Вернуть выдачу главной стенда, затем прогнать сторожа главной и убедиться, что он проходит зелёным.',
  });
  console.error('status', status);
}

async function reportDrift(checked, bad) {
  const head = `Главная стенда разъехалась: ${bad.length} расхождений из ${checked} карточек.`;
  console.error('❌ ' + head);
  for (const b of bad.slice(0, 25)) console.error('   · ' + b);
  await openTask({
    key: TASK_KEY,
    summary: head,
    details: [head, ...bad.slice(0, 25).map((b) => '· ' + b)].join('\n'),
    instructions: 'Пересобрать карточки главной и устранить причину расхождения (карточка целиком от одной статьи, статья стоит в своём блоке), затем прогнать сторожа главной.',
  });
}

const healed = await healFrontpage();
if (snapshotIsHealed(healed)) {
  await closeTask(TASK_KEY, 'Главная стенда снова собрана верно — сторож прошёл зелёным.');
  console.log(`✓ главная: ${healed.checked} карточек — каждая от одной статьи и в своём блоке`
    + (healed.repaired ? ' (пересобрана)' : ''));
  process.exit(0);
}
if (Number(healed.status) >= 400 && !healed.checked) {
  await reportDown(healed.status);
  process.exit(1);
}
if (Array.isArray(healed.bad) && healed.bad.length) {
  await reportDrift(healed.checked || 0, healed.bad);
  process.exit(1);
}

const db = new pg.Pool({ connectionString: process.env.SVIC_PLATFORM_DATABASE_URL, ssl: { rejectUnauthorized: false } });
const canon = await loadCanon(db);
const res = await fetchHome();
if (res.status >= 300 && res.status < 400) {
  await db.end();
  await reportDown(res.status);
  process.exit(1);
}
if (!res.ok) {
  await db.end();
  await reportDown(res.status);
  process.exit(1);
}
const { checked, bad } = inspectHtml(await res.text(), canon);
await db.end();
if (bad.length) {
  await reportDrift(checked, bad);
  process.exit(1);
}
await closeTask(TASK_KEY, 'Главная стенда снова собрана верно — сторож прошёл зелёным.');
console.log(`✓ главная: ${checked} карточек — каждая от одной статьи и в своём блоке`);
process.exit(0);
