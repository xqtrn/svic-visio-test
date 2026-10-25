// desk-fixture.mjs — the Trade Desk Matches screen in a real browser (WebKit
// iPhone or desktop Chromium) with the BRANCH page (overrides/desk/trade-desk.html)
// and a fixture desk (overrides/desk/fixture.json: production companies and
// terms, every partner a cast placeholder). Live platform static assets; no
// session, no write reaches the platform (every /api/ call is answered here).
// Env: ENGINE (webkit|chromium), CANDIDATE (1 = the candidate preview).
import { webkit, chromium } from 'playwright';
import fs from 'fs';

const ENGINE = process.env.ENGINE === 'chromium' ? 'chromium' : 'webkit';
const CANDIDATE = process.env.CANDIDATE === '1';
const BASE = 'https://platform.siliconvalleyinvestclub.com';
const OUT = 'out';
fs.mkdirSync(OUT, { recursive: true });
const PROBE = fs.readFileSync('overrides/ds-spacing-probe.browser.js', 'utf8');
const PAGE = fs.readFileSync('overrides/desk/trade-desk.html', 'utf8');
const FX = JSON.parse(fs.readFileSync('overrides/desk/fixture.json', 'utf8'));
const timed = (o) => JSON.parse(JSON.stringify(o).replace(/"__NOW([+-]\d+)?__"/g, (_, d) => JSON.stringify(new Date(Date.now() + (d ? Number(d) * 60000 : 0)).toISOString())));
const profile = ENGINE === 'webkit'
  ? { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }
  : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const ctx = await browser.newContext({ ...profile, timezoneId: 'America/Los_Angeles', locale: 'en-US' });
if (CANDIDATE) await ctx.addCookies([{ name: 'svic_candidate', value: '1', domain: 'platform.siliconvalleyinvestclub.com', path: '/' }]);
const report = { engine: ENGINE, candidate: CANDIDATE, steps: [], errors: [], posts: [] };
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
await ctx.route((url) => url.hostname === 'platform.siliconvalleyinvestclub.com', async (route, req) => {
  const u = new URL(req.url());
  if (req.resourceType() === 'document' && /^\/desk\//.test(u.pathname)) {
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE });
  }
  if (!u.pathname.startsWith('/api/')) return route.fallback();
  if (req.method() !== 'GET') {
    report.posts.push({ method: req.method(), path: u.pathname, body: req.postData() });
    if (CANDIDATE) return route.fulfill(json({ error: 'Opens once you are registered with Finalis and have passed your FINRA exams.', code: 'candidate_read_only' }, 403));
    if (/\/price-report$/.test(u.pathname)) {
      const b = JSON.parse(req.postData() || '{}');
      if (!b.note || b.note.length < 3) return route.fulfill(json({ error: 'Write down what they said, in their words', code: 'note_required' }, 422));
      return route.fulfill(json({ ok: true, side: b.side, fields: {} }));
    }
    return route.fulfill(json({ ok: true }));
  }
  if (u.pathname === '/api/desk/whoami') return route.fulfill(json(CANDIDATE ? { person: 'me', name: 'You', mode: 'demo', sections: FX.whoami.sections } : FX.whoami));
  if (u.pathname === '/api/desk/matches') {
    const m = timed(FX.matches);
    if (!CANDIDATE) return route.fulfill(json(m));
    return route.fulfill(json({ ...m, person: 'demo', mode: 'demo', readOnly: true, mine: [],
      gaps: m.mine.map((x) => ({ ...x, id: 'cg' + x.id, claim: null, reach: undefined, priceGap: { missing: x.priceGap.missing } })).concat(m.gaps) }));
  }
  return route.fulfill(json({ rows: [], items: [] }));
});
const page = await ctx.newPage();
page.on('pageerror', (e) => report.errors.push({ step: 'pageerror', error: String(e).slice(0, 300) }));
page.on('dialog', (d) => { report.errors.push({ step: 'native-dialog', error: d.message() }); d.dismiss().catch(() => {}); });
let n = 0;
async function shot(name, { full = true } = {}) {
  n += 1;
  const base = `${String(n).padStart(2, '0')}-${name}`;
  await page.waitForTimeout(700);
  const probe = await page.evaluate(() => ({ url: location.pathname + location.search, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  await page.screenshot({ path: `${OUT}/${base}.png` });
  if (full) await page.screenshot({ path: `${OUT}/${base}-full.png`, fullPage: true }).catch(() => {});
  const spacing = await page.evaluate(PROBE).catch((e) => ({ error: String(e).slice(0, 120) }));
  const step = { n, name, ...probe, overflow: probe.scrollWidth > probe.innerWidth + 1, spacing };
  report.steps.push(step);
  console.log('[shot]', JSON.stringify(step));
}
async function scrollTo(sel) {
  await page.evaluate((s) => { const el = document.querySelector(s); if (el) el.scrollIntoView({ block: 'start' }); }, sel);
}
try {
  const held = (FX.matches.mine[0] || {}).id;
  const both = (FX.matches.mine[1] || {}).id;
  await page.goto(BASE + '/desk/matches?lens=gaps', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.td-home-lens', { timeout: 30000 });
  await shot('home-missing-price');
  if (ENGINE === 'webkit') {
    await page.click('#railToggle');
    await page.waitForTimeout(500);
    await shot('rail-missing-price', { full: false });
    await page.click('#railToggle');
  }
  const free = FX.matches.gaps[0];
  await page.goto(BASE + '/desk/matches/' + encodeURIComponent(CANDIDATE ? 'cg' + held : free.id), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tdTake', { timeout: 30000 });
  await shot('gap-pair-free');
  if (CANDIDATE) {
    report.takeLocked = await page.evaluate(() => document.getElementById('tdTake').classList.contains('ds-locked'));
    await page.click('#tdTake').catch(() => {});
    report.postsAfterLockedTake = report.posts.length;
  } else {
    await page.goto(BASE + '/desk/matches/' + held, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#tdReport', { timeout: 30000 });
    await shot('held-pair-top', { full: false });
    await scrollTo('#tdTask');
    await shot('held-pair-task', { full: false });
    await page.click('#rpSave');
    await page.waitForTimeout(300);
    report.emptySubmitError = await page.textContent('#rpErr');
    await page.fill('#rpPrice', '412.50');
    await page.fill('#rpSize', '25M');
    await page.selectOption('#rpStructure', 'SPV');
    await page.fill('#rpNote', 'Seller: 412.50 for the whole block, SPV');
    await scrollTo('#rpSave');
    await shot('held-pair-form-filled', { full: false });
    await page.click('#rpSave');
    await page.waitForTimeout(1200);
    report.toast = await page.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
    await page.goto(BASE + '/desk/matches/' + both, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#tdReport', { timeout: 30000 });
    await scrollTo('#tdTask');
    await shot('both-sides-task', { full: true });
  }
} catch (e) {
  report.errors.push({ step: 'run', error: String(e).slice(0, 400) });
  await shot('error').catch(() => {});
}
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log('[done]', JSON.stringify({ steps: report.steps.length, errors: report.errors, takeLocked: report.takeLocked, toast: report.toast, emptySubmitError: report.emptySubmitError, posts: report.posts.length }));
await browser.close();
