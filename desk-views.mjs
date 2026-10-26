// desk-views.mjs — Trade Desk on a phone: the list and the open page are two
// views, one at a time, and nothing invisible takes the taps meant for the list
// (onboarding QA 2026-10-23 / 10-25: the first pair in Matches could not be
// tapped on a real iPhone). Real WebKit with an iPhone profile, or desktop
// Chromium to confirm the desktop layout is unchanged.
//
// SOURCE=fixture (default): every /api/ call is answered from
//   overrides/desk/fixture.json (production companies and terms, cast partners);
//   PAGE=branch serves overrides/desk/trade-desk.html, PAGE=main the baseline
//   overrides/desk/trade-desk-main.html (the page before the change).
// SOURCE=live: the live platform with the session in DESK_COOKIES (a secret set
//   for the run and deleted right after; QA users only). Nothing is written:
//   the walk only opens and closes pages.
// Env: ENGINE (webkit|chromium), CANDIDATE (1 = candidate preview, fixture only).
import { webkit, chromium } from 'playwright';
import fs from 'fs';

const ENGINE = process.env.ENGINE === 'chromium' ? 'chromium' : 'webkit';
const SOURCE = process.env.SOURCE === 'live' ? 'live' : 'fixture';
const PAGE_SRC = process.env.PAGE === 'main' ? 'main' : 'branch';
const CANDIDATE = process.env.CANDIDATE === '1';
const BASE = 'https://platform.siliconvalleyinvestclub.com';
const OUT = 'out';
fs.mkdirSync(OUT, { recursive: true });
const PROBE = fs.readFileSync('overrides/ds-spacing-probe.browser.js', 'utf8');
// branch = the page under review; main = the page live before it (the baseline).
const PAGE = fs.readFileSync(PAGE_SRC === 'main' ? 'overrides/desk/trade-desk-main.html' : 'overrides/desk/trade-desk.html', 'utf8');
const FX = JSON.parse(fs.readFileSync('overrides/desk/fixture.json', 'utf8'));
const timed = (o) => JSON.parse(JSON.stringify(o).replace(/"__NOW([+-]\d+)?__"/g, (_, d) => JSON.stringify(new Date(Date.now() + (d ? Number(d) * 60000 : 0)).toISOString())));
const profile = ENGINE === 'webkit'
  ? { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }
  : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const ctx = await browser.newContext({ ...profile, timezoneId: 'America/Los_Angeles', locale: 'en-US' });
const report = { engine: ENGINE, source: SOURCE, page: PAGE_SRC, candidate: CANDIDATE, steps: [], checks: [], errors: [], posts: [] };
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, detail }); console.log(ok ? '[ok]' : '[FAIL]', name, detail ? JSON.stringify(detail) : ''); };
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

if (SOURCE === 'live') {
  const raw = String(process.env.DESK_COOKIES || '').trim();
  if (!raw) throw new Error('DESK_COOKIES is empty');
  await ctx.addCookies(raw.split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf('=');
    return { name: p.slice(0, i), value: p.slice(i + 1), domain: 'platform.siliconvalleyinvestclub.com', path: '/', secure: true, sameSite: 'Lax' };
  }));
  // Read-only walk: a write would be a defect of this script, so it is refused here.
  await ctx.route((url) => url.hostname === 'platform.siliconvalleyinvestclub.com' && url.pathname.startsWith('/api/'), (route, req) => {
    if (req.method() === 'GET' || req.method() === 'HEAD') return route.fallback();
    const p = new URL(req.url()).pathname;
    if (/^\/api\/(activity|nav|client-errors|telemetry)/.test(p)) return route.fallback();
    report.posts.push({ method: req.method(), path: p });
    return route.fulfill(json({ error: 'refused by the read-only walk' }, 403));
  });
} else {
  if (CANDIDATE) await ctx.addCookies([{ name: 'svic_candidate', value: '1', domain: 'platform.siliconvalleyinvestclub.com', path: '/' }]);
  const pairs = [].concat(FX.matches.available || [], FX.matches.gaps || []);
  const byCo = new Map();
  for (const m of pairs) {
    if (!m.company) continue;
    const c = byCo.get(m.company) || { company: m.company, offers: [], bids: [] };
    const row = (s) => ({ id: m.id, structure: s.structure, share_class: s.shareClass, volume: s.volume, valuation: null, price: s.price, contact_name: CANDIDATE ? '' : s.from });
    if (m.sell) c.offers.push(row(m.sell));
    if (m.buy) c.bids.push(row(m.buy));
    byCo.set(m.company, c);
  }
  const companies = [...byCo.values()].sort((a, b) => (b.offers.length + b.bids.length) - (a.offers.length + a.bids.length));
  await ctx.route((url) => url.hostname === 'platform.siliconvalleyinvestclub.com', async (route, req) => {
    const u = new URL(req.url());
    if (req.resourceType() === 'document' && /^\/desk\//.test(u.pathname)) {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE });
    }
    if (!u.pathname.startsWith('/api/')) return route.fallback();
    if (req.method() !== 'GET') {
      report.posts.push({ method: req.method(), path: u.pathname });
      return route.fulfill(json(CANDIDATE ? { error: 'Opens once you are registered with Finalis and have passed your FINRA exams.', code: 'candidate_read_only' } : { ok: true }, CANDIDATE ? 403 : 200));
    }
    if (u.pathname === '/api/desk/whoami') return route.fulfill(json(CANDIDATE ? { person: 'me', name: 'You', mode: 'demo', sections: FX.whoami.sections } : FX.whoami));
    if (u.pathname === '/api/desk/matches') {
      const m = timed(FX.matches);
      if (!CANDIDATE) return route.fulfill(json(m));
      return route.fulfill(json({ ...m, person: 'demo', mode: 'demo', readOnly: true, mine: [],
        gaps: m.mine.map((x) => ({ ...x, id: 'cg' + x.id, claim: null, reach: undefined, priceGap: { missing: x.priceGap.missing } })).concat(m.gaps) }));
    }
    if (u.pathname === '/api/desk/companies') {
      return route.fulfill(json({ rows: companies.map((c) => ({ company: c.company, offers: c.offers.length, bids: c.bids.length })) }));
    }
    const co = /^\/api\/desk\/company\/(.+)$/.exec(u.pathname);
    if (co) {
      const c = byCo.get(decodeURIComponent(co[1])) || { offers: [], bids: [] };
      return route.fulfill(json({ offers: c.offers, bids: c.bids }));
    }
    return route.fulfill(json({ rows: [], items: [] }));
  });
}

const page = await ctx.newPage();
page.on('pageerror', (e) => report.errors.push({ step: 'pageerror', error: String(e).slice(0, 300) }));
page.on('dialog', (d) => { report.errors.push({ step: 'native-dialog', error: d.message() }); d.dismiss().catch(() => {}); });
page.on('response', (r) => { if (r.status() >= 500 && /siliconvalleyinvestclub\.com/.test(r.url())) report.errors.push({ step: 'http5xx', url: r.url().replace(/\?.*/, ''), status: r.status() }); });
let n = 0;
async function shot(name, { full = false } = {}) {
  n += 1;
  const base = `${String(n).padStart(2, '0')}-${name}`;
  await page.waitForTimeout(600);
  const probe = await page.evaluate(() => ({ url: location.pathname + location.search, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  await page.screenshot({ path: `${OUT}/${base}.png` });
  if (full) await page.screenshot({ path: `${OUT}/${base}-full.png`, fullPage: true }).catch(() => {});
  const spacing = await page.evaluate(PROBE).catch((e) => ({ error: String(e).slice(0, 120) }));
  const step = { n, name, ...probe, overflow: probe.scrollWidth > probe.innerWidth + 1, spacing };
  report.steps.push(step);
  console.log('[shot]', JSON.stringify({ n, name, url: probe.url, overflow: step.overflow, spacing: spacing && spacing.verdict }));
}
// What the page shows and what a finger on <sel> would actually hit.
const state = (sel) => page.evaluate((s) => {
  const vis = (q) => { const e = document.querySelector(q); return e ? getComputedStyle(e).display : 'missing'; };
  const btn = document.getElementById('railToggle');
  const head = document.getElementById('deskHead');
  const side = document.querySelector('.td-side');
  const out = {
    side: vis('.td-side'), main: vis('.td-main'), head: head ? getComputedStyle(head).display : 'missing',
    sideWidth: side ? Math.round(side.getBoundingClientRect().width) : 0,
    act: btn ? (btn.dataset.act || '') : '', label: btn ? btn.textContent.trim() : '',
    path: location.pathname, scrollTop: (document.getElementById('scroll') || {}).scrollTop || 0,
  };
  if (s) {
    const el = [...document.querySelectorAll(s)].find((e) => e.getClientRects().length > 0) || null;
    if (!el) out.hit = 'missing';
    else {
      let r = el.getBoundingClientRect();
      // Off screen is not «covered»: bring it into view the way a thumb scroll would.
      if (r.top < 0 || r.bottom > window.innerHeight) { el.scrollIntoView({ block: 'center' }); r = el.getBoundingClientRect(); }
      const x = r.left + Math.min(r.width / 2, 40), y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      out.hit = !!top && (top === el || el.contains(top));
      out.hitBy = top && !out.hit ? (top.id ? '#' + top.id : top.className || top.tagName) : '';
      out.box = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    }
  }
  return out;
}, sel || null);
const waitAct = (act) => page.waitForFunction((a) => { const b = document.getElementById('railToggle'); return b && b.dataset.act === a; }, act, { timeout: 20000 });
const waitRows = () => page.waitForSelector('#convo .td-pair-row >> visible=true', { timeout: 30000 });
const tap = async (sel) => { const l = page.locator(sel).first(); if (ENGINE === 'webkit') await l.tap({ timeout: 10000 }); else await l.click({ timeout: 10000 }); };

async function phone() {
  // 1. Matches start screen = the list.
  await page.goto(BASE + '/desk/matches', { waitUntil: 'domcontentloaded' });
  await waitRows();
  await page.waitForTimeout(800);
  let s = await state('#convo .td-pair-row .nm');
  check('matches list: only the page, no rail beside it', s.side === 'none' && s.main !== 'none', s);
  check('matches list: first pair is what a finger hits', s.hit === true, s);
  check('matches list: head offers the full list', s.act === 'list', { label: s.label });
  await shot('matches-list', { full: true });

  // 2. Tap the first pair by its company name.
  const firstId = await page.getAttribute('#convo .td-pair-row', 'data-mid');
  await tap('#convo .td-pair-row .nm');
  await waitAct('up');
  await page.waitForSelector('#tdTake, .td-figs, .td-claim', { timeout: 20000 });
  s = await state();
  check('first pair opens its own view', s.path.endsWith('/' + firstId) && s.side === 'none', s);
  check('match view has a Back control', s.act === 'up' && /Matches/.test(s.label) && s.head !== 'none', { label: s.label, head: s.head });
  await shot('match-open', { full: true });

  // 3. Back → the list again.
  await tap('#railToggle');
  await waitAct('list');
  await waitRows();
  s = await state('#convo .td-pair-row .nm');
  check('Back returns to the list', /\/desk\/matches$/.test(s.path) && s.hit === true, s);
  await shot('back-to-list');

  // 4. A pair far down the list: Back lands where the list was left.
  const rows = await page.locator('#convo .td-pair-row').count();
  if (rows >= 8) {
    await page.evaluate(() => { const r = document.querySelectorAll('#convo .td-pair-row')[7]; r.scrollIntoView({ block: 'center' }); });
    await page.waitForTimeout(400);
    const before = (await state()).scrollTop;
    const h = await state('#convo .td-pair-row:nth-of-type(8) .nm');
    await page.locator('#convo .td-pair-row').nth(7).locator('.nm').tap().catch(async () => page.locator('#convo .td-pair-row').nth(7).locator('.nm').click());
    await waitAct('up');
    const opened = await state();
    check('a pair down the list opens at its top', opened.scrollTop === 0, { scrollTop: opened.scrollTop, before, hit: h.hit });
    await tap('#railToggle');
    await waitAct('list');
    await waitRows();
    await page.waitForTimeout(500);
    const after = (await state()).scrollTop;
    check('Back keeps the place in the list', Math.abs(after - before) < 40, { before, after });
  }

  // 5. «Missing price» on the start screen (rows under the switch, not the held pairs above it).
  const GAP_ROW = '#convo .td-home-lens ~ .td-q .td-pair-row .nm';
  if (await page.locator('#convo [data-lens="gaps"]').count()) {
    await tap('#convo [data-lens="gaps"]');
    await page.waitForFunction(() => /Missing price/.test((document.querySelector('#convo') || {}).textContent || '') && document.querySelector('#convo [data-lens="gaps"].on'), null, { timeout: 15000 });
    await page.evaluate(() => { const sc = document.getElementById('scroll'); if (sc) sc.scrollTop = 0; });
    s = await state(GAP_ROW);
    check('missing price list: first pair is what a finger hits', s.hit === true, s);
    await shot('missing-price-list', { full: true });
    if (s.hit !== 'missing') {
      await tap(GAP_ROW);
      await waitAct('up');
      await page.waitForSelector('#tdTake, .td-figs', { timeout: 20000 });
      await shot('missing-price-match');
      await tap('#railToggle');
      await waitAct('list');
      await waitRows();
    }
    await tap('#convo [data-lens="priced"]');
    await page.waitForTimeout(500);
  }

  // 6. The full list (search, held by others) — a view of its own.
  await tap('#railToggle');
  await page.waitForSelector('#coList .co-item[data-mid]', { timeout: 15000 });
  await page.waitForTimeout(400);
  s = await state('#coList .co-item[data-mid] .co-name');
  check('full list: the list alone, full width', s.main === 'none' && s.side !== 'none' && s.sideWidth >= 390, s);
  check('full list: first pair is what a finger hits', s.hit === true, s);
  check('full list: way back to the start screen', s.act === 'page' && /Overview/.test(s.label), { label: s.label });
  const search = await state('#coSearch');
  check('full list: search is visible and takes the finger', search.hit === true, search);
  await shot('full-list');
  await tap('#coList .co-item[data-mid] .co-name');
  await waitAct('up');
  s = await state();
  check('pair from the full list opens alone', s.side === 'none' && s.main !== 'none', s);
  await shot('full-list-open');
  await tap('#railToggle');
  await waitAct('list');
  await waitRows();

  // 7. Order Book.
  await page.goto(BASE + '/desk/order-book', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#coList .co-item', { timeout: 30000 });
  await page.waitForTimeout(800);
  s = await state('#coList .co-item .co-name');
  check('order book: the list alone', s.main === 'none' && s.sideWidth >= 390, s);
  check('order book: first company is what a finger hits', s.hit === true, s);
  const obSearch = await state('#coSearch');
  check('order book: search is visible and takes the finger', obSearch.hit === true, obSearch);
  await shot('order-book-list');
  await tap('#coList .co-item .co-name');
  await waitAct('up');
  s = await state();
  check('order book: company opens alone with a Back control', s.side === 'none' && /Order Book/.test(s.label), s);
  await shot('order-book-company', { full: true });
  await tap('#railToggle');
  await page.waitForSelector('#coList .co-item', { timeout: 15000 });
  s = await state('#coList .co-item .co-name');
  check('order book: Back returns to the list', s.main === 'none' && s.hit === true && /\/desk\/order-book$/.test(s.path), s);
  await shot('order-book-back');
}

async function desktop() {
  await page.goto(BASE + '/desk/matches', { waitUntil: 'domcontentloaded' });
  await waitRows();
  await page.waitForTimeout(800);
  let s = await state('#convo .td-pair-row .nm');
  check('desktop matches: rail and page side by side, no page head', s.side !== 'none' && s.main !== 'none' && s.head === 'none' && s.sideWidth === 384, s);
  await shot('desktop-matches');
  await page.locator('#convo .td-pair-row >> visible=true').first().locator('[data-open-match]').click();
  await page.waitForSelector('#tdTake, .td-figs', { timeout: 20000 });
  s = await state();
  check('desktop: Open still opens the pair beside the rail', s.side !== 'none' && s.sideWidth === 384, s);
  await shot('desktop-match-open');
  await page.goto(BASE + '/desk/order-book', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#coList .co-item', { timeout: 30000 });
  await page.waitForTimeout(1500);
  s = await state();
  check('desktop order book: rail and first company side by side', s.side !== 'none' && s.main !== 'none' && s.sideWidth === 288, s);
  await shot('desktop-order-book');
}

try {
  if (ENGINE === 'webkit') await phone(); else await desktop();
} catch (e) {
  report.errors.push({ step: 'run', error: String(e).slice(0, 600) });
  await shot('error').catch(() => {});
}
report.failed = report.checks.filter((c) => !c.ok).map((c) => c.name);
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log('[done]', JSON.stringify({ steps: report.steps.length, checks: report.checks.length, failed: report.failed, errors: report.errors.map((e) => e.step + ': ' + e.error).slice(0, 5), posts: report.posts.length }));
await browser.close();
