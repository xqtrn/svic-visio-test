// events-scan.mjs — ежедневный демон «Webinars & Events» (Артур 2026-07-12).
// Ищет НОВЫЕ top-tier мероприятия private markets / institutional investing
// (Claude + web search, temperature 0 — канон структурных проверок), фильтрует
// по планке организатора, качает лого, обновляет релиз events (events.json).
// Потребитель: testnew-edge worker — страница /events/ на стенде.

import fs from 'node:fs';
import { execSync } from 'node:child_process';

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
const have = new Set(cur.events.map((e) => e.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()));

const prompt = `Today is ${today}. You are the events curator for an institutional private-markets investment desk (pre-IPO secondaries, unicorn coverage).

Find conferences and research webinars announced for the NEXT 12 MONTHS that are TOP-TIER only: hosted by bulge-bracket banks (Goldman Sachs, J.P. Morgan, Morgan Stanley), Milken Institute, Informa/SuperReturn, IPEM, iConnections, CNBC, Bloomberg, PitchBook/NVCA, Preqin/BlackRock, Forge, Nasdaq or equivalent. Institutional audience only — no vendor pitches, no local meetups, no paid-speaker mills.

Already tracked (do NOT repeat): ${cur.events.map((e) => e.title).join('; ')}

Return ONLY a JSON array (no prose). Each item:
{"title":"...","organizer":"...","format":"Conference|Webinar","start":"YYYY-MM-DD","end":"YYYY-MM-DD or omit","dateLabel":"human dates","city":"City or Virtual","url":"official event page","blurb":"1-2 sentences IN YOUR OWN WORDS (institutional tone, никакого копипаста маркетинга)"}
If a confirmed date is unknown, omit the event. If nothing new qualifies, return [].`;

const r = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
  body: JSON.stringify({
    model: 'claude-sonnet-5',
    max_tokens: 4000,
    temperature: 0,
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

// прошедшие — вон; новые — в хвост; сортировка по дате
const events = cur.events
  .filter((e) => (e.end || e.start || '9999') >= today)
  .concat(fresh)
  .sort((a, b) => (a.start || '').localeCompare(b.start || ''));

const changed = fresh.length || events.length !== cur.events.length;
if (!changed) { console.log('no changes'); process.exit(0); }

fs.writeFileSync('events.json', JSON.stringify({ updated: today, source: 'seed+daemon', events }, null, 1));
const assets = ['events.json'].concat(fresh.filter((e) => e.logo).map((e) => e.logo));
execSync('gh release upload events ' + assets.join(' ') + ' --clobber', { stdio: 'inherit' });
console.log('published: +' + fresh.length + ' new, total ' + events.length);
