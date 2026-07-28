#!/usr/bin/env node
/* Сторож главной стенда — облачный (Артур 2026-07-28).
 *
 * Смотрит на живую выдачу test.siliconvalleyinvestclub.com глазами читателя и
 * проверяет два условия, которых на главной не было и которые Артур поймал сам:
 *   1) карточка принадлежит ОДНОЙ статье — заголовок, адрес и дата не могут быть
 *      от разных (класс «сшитая карточка»: фото Anduril под заголовком Humanoid);
 *   2) карточка стоит в СВОЁМ блоке — под «New Unicorn Companies» статья с тегом
 *      новых единорогов, под «Европой» европейская;
 *   3) на главной вообще есть карточки — тело страницы не должно вырождаться
 *      (28 июля сайт отдал шапку с подвалом и пустой серединой).
 * Истина о статьях — база, а не разметка.
 *
 * Молчит, пока всё в порядке; расхождение — сообщение в Телеграм и красный
 * прогон. Секреты: SVIC_PLATFORM_DATABASE_URL, TELEGRAM_BOT_TOKEN.
 */
import pg from 'pg';

const HOST = process.env.SVIC_HOST || 'https://test.siliconvalleyinvestclub.com';
const CHAT = process.env.TELEGRAM_CHAT_ID || '305112149';
const UNICORN_TAG = 1411;
const MIN_CARDS = 40;

const plain = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (s) => plain(s).replace(/&(?:amp|#0*38);/gi, '&').replace(/[’']/g, "'").replace(/[–—]/g, '-').toLowerCase();

async function tg(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text, disable_web_page_preview: true }),
    });
  } catch { /* сторож не должен падать из-за почтальона */ }
}

const db = new pg.Pool({ connectionString: process.env.SVIC_PLATFORM_DATABASE_URL, ssl: { rejectUnauthorized: false } });
const posts = (await db.query(`SELECT slug, title, categories, tags FROM posts WHERE status='publish'`)).rows;
const bySlug = new Map(posts.map((p) => [p.slug.toLowerCase(), p]));
const cats = (await db.query(`SELECT wp_id, name FROM taxonomy`)).rows;
const byName = new Map(cats.map((c) => [plain(c.name).toLowerCase(), Number(c.wp_id)]));
await db.end();

const ruleOf = (headingRaw) => {
  const h = plain(headingRaw).toLowerCase();
  if (!h) return { type: 'latest' };
  if (h.includes('unicorn')) return { type: 'tag', id: UNICORN_TAG };
  if (byName.has(h)) return { type: 'category', id: byName.get(h) };
  return null;
};

const res = await fetch(HOST + '/', { headers: { Cookie: 'svic_token=edge-preview', 'User-Agent': 'svic-frontpage-guard' } });
if (!res.ok) { await tg(`Главная стенда отдала ${res.status}. Карточки не проверены.`); console.error('status', res.status); process.exit(1); }
const html = await res.text();

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
  const block = headingAt(m.index);
  const post = bySlug.get(decodeURIComponent(slug).toLowerCase());
  checked++;
  if (!post) { bad.push(`${block || 'верх'}: ссылка на несуществующую статью /${y}/${mo}/${d}/${slug}/`); continue; }
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

if (bad.length) {
  const head = `Главная стенда разъехалась: ${bad.length} расхождений из ${checked} карточек.`;
  console.error('❌ ' + head);
  for (const b of bad.slice(0, 25)) console.error('   · ' + b);
  await tg([head, ...bad.slice(0, 8).map((b) => '· ' + b), 'Лечится пересборкой карточек главной.'].join('\n'));
  process.exit(1);
}
console.log(`✓ главная: ${checked} карточек — каждая от одной статьи и в своём блоке`);
