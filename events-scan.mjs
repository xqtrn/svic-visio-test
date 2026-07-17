// events-scan.mjs — ежедневный демон «Webinars & Events» (Артур 2026-07-12).
// Ищет НОВЫЕ top-tier мероприятия private markets / institutional investing
// (Claude + web search, temperature 0 — канон структурных проверок), фильтрует
// по планке организатора, качает лого, обновляет релиз events (events.json).
// Потребитель: testnew-edge worker — страница /events/ на стенде.

import fs from 'node:fs';
import { execSync } from 'node:child_process';
import pg from 'pg';

// SOT событий с 2026-07-16 — site_blocks.events в БД стенда (правится админкой);
// релиз остаётся fallback-датасетом воркера и хранилищем лого. Демон ЧИТАЕТ
// админ-блок (уже отслеженное + надгробия removed), ДОБАВЛЯЕТ новое туда и в
// релиз, существующие записи не трогает (правки админа всегда старше). Каждый
// прогон отчитывается в audit_log (action='daemon.run') — админка показывает
// работу демона. БД недоступна → работаем по-старому через релиз (fail-open).
const pool = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;
async function reportRun(after){
  if (!pool) return;
  try {
    await pool.query(
      "INSERT INTO audit_log (actor, action, entity_type, after) VALUES ('daemon:events-scan','daemon.run','daemon:events',$1)",
      [JSON.stringify(after)]);
  } catch (e) { console.warn('[report] failed:', e.message); }
}

const REL = 'https://github.com/xqtrn/svic-visio-test/releases/download/events/events.json';
const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('no ANTHROPIC_API_KEY'); process.exit(1); }

const today = new Date().toISOString().slice(0, 10);

// Планка качества — организатор из высшей лиги. Хард-гейт: не в списке → не берём.
const TIER = [
  'goldman sachs', 'j.p. morgan', 'jpmorgan', 'morgan stanley', 'blackrock', 'preqin',
  'milken', 'informa', 'superreturn', 'ipem', 'iconnections', 'cnbc', 'bloomberg',
  'pitchbook', 'nvca', 'forge', 'nasdaq', 'salt', 'world economic forum', 'techcrunch',
];

const cur = await (await fetch(REL)).json();
let adminBlock = null;
if (pool) {
  try { adminBlock = (await pool.query("SELECT value FROM site_blocks WHERE key='events'")).rows[0]?.value || null; }
  catch (e) { console.warn('[db] read failed:', e.message); }
}
const tracked = (adminBlock && Array.isArray(adminBlock.items) && adminBlock.items.length) ? adminBlock.items : cur.events;
const removedIds = new Set(((adminBlock && adminBlock.removed) || []).map(String));
const have = new Set(tracked.map((e) => e.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()));

const prompt = `Today is ${today}. You are the events curator for an institutional private-markets investment desk (pre-IPO secondaries, unicorn coverage).

Find conferences and research webinars announced for the NEXT 12 MONTHS that are TOP-TIER only: hosted by bulge-bracket banks (Goldman Sachs, J.P. Morgan, Morgan Stanley), Milken Institute, Informa/SuperReturn, IPEM, iConnections, CNBC, Bloomberg, PitchBook/NVCA, Preqin/BlackRock, Forge, Nasdaq or equivalent. Institutional audience only — no vendor pitches, no local meetups, no paid-speaker mills.

Already tracked (do NOT repeat): ${tracked.map((e) => e.title).join('; ')}

Return ONLY a JSON array (no prose). Each item:
{"title":"...","organizer":"...","format":"Conference|Webinar","start":"YYYY-MM-DD","end":"YYYY-MM-DD or omit","dateLabel":"EXACT human dates (e.g. \"September 8\u201310, 2026\")","city":"City or Virtual","url":"official event page","blurb":"1-2 sentences IN YOUR OWN WORDS (institutional tone, no marketing copy-paste)","details":"3-4 sentences IN YOUR OWN WORDS for the event page: what happens there, who attends, why it matters","highlights":["3 short factual bullets"],"audience":"who attends, short","scale":"attendance figure if VERIFIED, else omit"}
If a confirmed date is unknown, omit the event. If nothing new qualifies, return [].`;

const r = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
  body: JSON.stringify({
    model: 'claude-sonnet-5',
    max_tokens: 4000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
    messages: [{ role: 'user', content: prompt }],
  }),
});
if (!r.ok) { console.error('anthropic http ' + r.status, (await r.text()).slice(0, 300)); process.exit(1); }
const msg = await r.json();
const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
const jm = text.match(/\[[\s\S]*\]/);
let found = [];
try { found = jm ? JSON.parse(jm[0]) : []; } catch (e) { console.error('parse fail'); }
console.log('candidates:', found.length);

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const fresh = [];
for (const e of found) {
  if (!e || !e.title || !e.url || !e.start || !/^\d{4}-\d{2}-\d{2}$/.test(e.start)) continue;
  if (e.start < today) continue;
  const key = e.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (have.has(key)) continue;
  if (!TIER.some((t) => (e.organizer || '').toLowerCase().includes(t) || key.includes(t))) { console.log('below tier:', e.title); continue; }
  try {
    const h = await fetch(e.url, { method: 'HEAD', redirect: 'follow' });
    if (h.status >= 400 && h.status !== 403) { console.log('dead url:', e.url, h.status); continue; }
  } catch (err) { console.log('unreachable:', e.url); continue; }
  e.id = slug(e.title);
  // лого: unavatar по домену организатора/ивента; мелкое/битое → монограмма на странице
  try {
    const host = new URL(e.url).hostname.replace(/^www\./, '');
    const lr = await fetch('https://unavatar.io/' + host, { redirect: 'follow' });
    const buf = Buffer.from(await lr.arrayBuffer());
    if (lr.ok && buf.length > 800 && (buf[0] === 0x89 || buf[0] === 0xff)) {
      fs.writeFileSync(e.id + '.png', buf);
      e.logo = e.id + '.png';
    }
  } catch (err) {}
  have.add(key);
  fresh.push(e);
}

// надгробия: удалённое админом руками демон не возвращает (ни в БД, ни в релиз)
const freshKept = fresh.filter((e) => !removedIds.has(e.id));

// прошедшие ОСТАЮТСЯ (архив на странице /events/, Артур 2026-07-12); новые — в хвост
const events = cur.events
  .concat(freshKept)
  .sort((a, b) => (a.start || '').localeCompare(b.start || ''));

// merge в БД (только добавление; существующие записи — собственность админа)
let dbAdded = 0;
if (pool && adminBlock) {
  try {
    const ids = new Set((adminBlock.items || []).map((e) => e.id));
    const add = freshKept.filter((e) => !ids.has(e.id));
    if (add.length) {
      const merged = (adminBlock.items || []).concat(add)
        .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
      await pool.query(
        "UPDATE site_blocks SET value = jsonb_set(value, '{items}', $1::jsonb), updated_by='daemon:events-scan', updated_at=now() WHERE key='events'",
        [JSON.stringify(merged)]);
      await pool.query(
        "INSERT INTO settings (key, value) VALUES ('content_version', '1') ON CONFLICT (key) DO UPDATE SET value = (COALESCE(settings.value::text, '0')::int + 1)::text::jsonb, updated_at = now()");
      dbAdded = add.length;
      console.log('[db] merged +' + add.length + ' into site_blocks.events');
    }
  } catch (e) { console.warn('[db] merge failed:', e.message); }
}

const changed = freshKept.length || events.length !== cur.events.length;
if (!changed) {
  console.log('no changes');
  await reportRun({ status: 'ok', found: fresh.length, added: 0, db_added: dbAdded, total: tracked.length });
  if (pool) await pool.end();
  process.exit(0);
}

fs.writeFileSync('events.json', JSON.stringify({ updated: today, source: 'seed+daemon', events }, null, 1));
const assets = ['events.json'].concat(freshKept.filter((e) => e.logo).map((e) => e.logo));
execSync('gh release upload events ' + assets.join(' ') + ' --clobber', { stdio: 'inherit' });
console.log('published: +' + fresh.length + ' new, total ' + events.length);
await reportRun({ status: 'ok', found: fresh.length, added: freshKept.length, db_added: dbAdded, total: (adminBlock && adminBlock.items ? adminBlock.items.length + dbAdded : events.length) });
if (pool) await pool.end();
