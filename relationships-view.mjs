// relationships-view.mjs — Sourcing «Relationships» lists (platform 2026-10-26, Daria:
// «окно, куда будем вносить имя компании, с кем сделали ватсап группу … отдельное окно
// для ввода имейлов в стоп-лист»). The branch page comes from overrides/sourcing; the
// platform's shared files are the live ones; every /api answer is a synthetic sample
// with production's shape (8 WhatsApp firms, 6 email relationships, 2 paused, 1 stop) —
// nothing reaches the platform's data, no real person is in the fixture.
// Env: ENGINE (webkit = iPhone 393 | chromium = desktop 1440).
import { webkit, chromium } from 'playwright';
import fs from 'fs';

const ENGINE = process.env.ENGINE === 'webkit' ? 'webkit' : 'chromium';
const OUT = 'out';
const DIR = 'overrides/sourcing';
fs.mkdirSync(OUT, { recursive: true });
const PROBE = fs.readFileSync('overrides/ds-spacing-probe.browser.js', 'utf8');
const F = JSON.parse(fs.readFileSync(`${DIR}/fixture.json`, 'utf8'));
const profile = ENGINE === 'webkit'
  ? { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }
  : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25 };
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const ctx = await browser.newContext({ ...profile, locale: 'en-US' });
const report = { engine: ENGINE, steps: [], errors: [], posts: [] };
const PLATFORM = 'platform.siliconvalleyinvestclub.com';
const json = (o, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(o) });
let rel = F.relationships;

await ctx.route((u) => u.hostname === PLATFORM, async (route, req) => {
  const p = new URL(req.url()).pathname;
  if (p === '/sourcing' || p === '/sourcing.html') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(`${DIR}/sourcing.html`) });
  if (p === '/api/nav') return route.fulfill(json({ menu: { pinned: [], groups: [] }, landing: '/' }));
  if (p === '/api/sourcing/relationships' && req.method() === 'GET') return route.fulfill(json(rel));
  if (p === '/api/sourcing/relationships' && req.method() === 'POST') {
    const body = JSON.parse(req.postData() || '{}');
    report.posts.push(body);
    return route.fulfill(json({ ok: true, added: [], moved: [], already: [], rejected: [{ input: 'Example Fund', reason: '«Example Fund» is not an email address or a firm domain' }] }));
  }
  if (/^\/api\/sourcing\/relationships\/\d+\/(checkin|remove)$/.test(p)) { report.posts.push({ path: p }); return route.fulfill(json({ ok: true, address: 'x@y.example' })); }
  if (p === '/api/sourcing/partners') return route.fulfill(json(F.partners));
  if (p.startsWith('/api/')) return route.fulfill(json({ error: 'sample stand' }, 404));
  return route.fallback();
});

const page = await ctx.newPage();
page.on('pageerror', (e) => report.errors.push({ step: 'pageerror', url: page.url(), error: String(e).slice(0, 300) }));
page.on('console', (m) => { if (m.type() === 'error' && !/404|sample stand|Content Security Policy|Failed to load resource/.test(m.text())) report.errors.push({ step: 'console', url: page.url(), error: m.text().slice(0, 300) }); });
page.on('dialog', (d) => { report.errors.push({ step: 'native-dialog', error: d.message() }); d.dismiss().catch(() => {}); });
let n = 0;
async function shot(name, extra = {}) {
  n += 1;
  await page.waitForTimeout(900);
  const base = `${String(n).padStart(2, '0')}-${name}`;
  await page.screenshot({ path: `${OUT}/${base}.png` });
  await page.screenshot({ path: `${OUT}/${base}-full.png`, fullPage: true }).catch(() => {});
  const probe = await page.evaluate(() => ({ url: location.host + location.pathname + location.hash, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })).catch(() => ({}));
  const spacing = await page.evaluate(PROBE).catch((e) => ({ error: String(e).slice(0, 120) }));
  const step = { n, name, file: `${base}.png`, ...probe, overflow: probe.scrollWidth > probe.innerWidth + 1, spacing, ...extra };
  report.steps.push(step);
  if (step.overflow) report.errors.push({ step: name, error: 'sideways scroll', scrollWidth: probe.scrollWidth });
  console.log('[shot]', JSON.stringify(step));
}
const panels = () => page.evaluate(() => [...document.querySelectorAll('.relPanel')].map((p) => ({
  tier: p.getAttribute('data-tier'), title: p.querySelector('h3')?.textContent.trim(), items: p.querySelectorAll('.relList li:not(.empty)').length,
  due: p.querySelectorAll('.tag.pending').length, width: Math.round(p.getBoundingClientRect().width),
})));

await page.goto(`https://${PLATFORM}/sourcing#relationships`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.relPanel[data-tier]', { timeout: 20000 }).catch(() => {});
let state = await panels();
await shot('lists-today', { panels: state, dueLine: await page.textContent('#relDue').catch(() => null) });
const want = { whatsapp_group: 8, email_relationship: 6, paused: 2, stop: 1 };
for (const [tier, count] of Object.entries(want)) {
  const p = state.find((x) => x.tier === tier);
  if (!p || p.items !== count) report.errors.push({ step: 'counts-today', tier, got: p && p.items, want: count });
}
await page.locator('.relPanel[data-tier="stop"]').scrollIntoViewIfNeeded();
await shot('lists-stop-panel');

// Paste a list that carries one wrong entry: the page reports it and leaves only it in the box.
await page.fill('[data-rel-input="stop"]', 'someone@example.com\nExample Fund');
await page.click('[data-rel-add="stop"]');
await page.waitForTimeout(800);
const leftover = await page.inputValue('[data-rel-input="stop"]').catch(() => null);
const msg = await page.textContent('[data-rel-msg="stop"]').catch(() => null);
await shot('add-with-rejected', { leftover, msg });
if (leftover !== 'Example Fund' || !/Not added/.test(msg || '')) report.errors.push({ step: 'rejected-entry', leftover, msg });

// Fifty days later the WhatsApp check-ins are due.
rel = F.later;
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.relPanel[data-tier]', { timeout: 20000 }).catch(() => {});
state = await panels();
await page.locator('.relPanel[data-tier="whatsapp_group"]').scrollIntoViewIfNeeded();
await shot('checkins-due', { panels: state, dueLine: await page.textContent('#relDue').catch(() => null) });
if ((state.find((x) => x.tier === 'whatsapp_group') || {}).due !== 8) report.errors.push({ step: 'due-tags', state });
await page.click('[data-rel-checkin]');
await page.waitForTimeout(500);

// The partner board shows the locks in words.
await page.goto(`https://${PLATFORM}/sourcing#partners`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('#pBody tr').length > 5, null, { timeout: 20000 }).catch(() => {});
const board = await page.evaluate(() => {
  const txt = document.getElementById('pBody').innerText;
  return { rows: document.querySelectorAll('#pBody tr').length, whatsapp: (txt.match(/firm on whatsapp/gi) || []).length, stop: /stop list/i.test(txt), link: !!document.querySelector('a[href="#relationships"]') };
});
await shot('partner-board-top', { board });
await page.evaluate(() => { const rows = [...document.querySelectorAll('#pBody tr')]; const hit = rows.find((r) => /firm on whatsapp/i.test(r.innerText)); if (hit) hit.scrollIntoView({ block: 'center' }); });
await shot('partner-board-locked');
if (!board.whatsapp || !board.stop || !board.link) report.errors.push({ step: 'board-labels', board });
if (!report.posts.some((p) => p.tier === 'stop') || !report.posts.some((p) => /checkin$/.test(p.path || ''))) report.errors.push({ step: 'posts', posts: report.posts });

fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log('[report]', JSON.stringify({ engine: ENGINE, steps: report.steps.length, errors: report.errors, posts: report.posts.length }));
await browser.close();
if (report.errors.length) process.exit(1);
