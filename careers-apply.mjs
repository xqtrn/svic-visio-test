// careers-apply.mjs — the careers application form a candidate opens from the
// personal link SITE/apply/<CODE>, in a real browser (Playwright WebKit with an
// iPhone profile, or desktop Chromium). Arthur 2026-10-04: platform.* is
// internal only — the candidate's browser must never contact it.
//
// Steps: personal link → form (screenshot) → type a name → autosave reaches the
// site (POST /api/public/hiring/draft, 204) → a FRESH browser (no local draft)
// opens the same link and the typed name comes back from the server draft
// (screenshot) → the application endpoint answers on the site origin (honeypot
// POST: the platform accepts it and writes nothing). Every request of every
// page is recorded; any request to the platform host fails the run.
// Env: SITE, PLATFORM, ENGINE (webkit | chromium), CODE (QA candidate code).
import { webkit, chromium } from 'playwright';
import fs from 'fs';

const SITE = (process.env.SITE || 'https://siliconvalleyinvestclub.com').replace(/\/$/, '');
const PLATFORM_HOST = new URL(process.env.PLATFORM || 'https://platform.siliconvalleyinvestclub.com').host;
const ENGINE = process.env.ENGINE === 'chromium' ? 'chromium' : 'webkit';
const CODE = process.env.CODE || '';
const TYPED = 'QA Careers Check';
const OUT = 'out';
fs.mkdirSync(OUT, { recursive: true });

const report = { engine: ENGINE, steps: [], errors: [], hosts: {}, platformRequests: [], api: [], checks: {} };
const profile = ENGINE === 'webkit'
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }
  : { viewport: { width: 1440, height: 900 } };
let n = 0;

async function shot(page, name, extra = {}) {
  n += 1;
  const file = `${String(n).padStart(2, '0')}-${name}.png`;
  await page.waitForTimeout(600);
  const probe = await page.evaluate(() => ({
    url: location.origin + location.pathname + location.search,
    scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
  })).catch(() => ({}));
  await page.screenshot({ path: `${OUT}/${file}` }).catch(() => {});
  const step = { n, name, file, ...probe, overflow: probe.scrollWidth > probe.innerWidth + 1, ...extra };
  report.steps.push(step);
  console.log('[shot]', JSON.stringify(step));
}

function watch(page, label) {
  page.on('request', (req) => {
    let u; try { u = new URL(req.url()); } catch (_) { return; }
    report.hosts[u.host] = (report.hosts[u.host] || 0) + 1;
    if (u.host === PLATFORM_HOST) report.platformRequests.push(`${label} ${req.method()} ${u.pathname}`);
  });
  page.on('response', (res) => {
    let u; try { u = new URL(res.url()); } catch (_) { return; }
    if (/^\/api\/public\/(hiring|hr)\//.test(u.pathname)) {
      const row = { page: label, method: res.request().method(), host: u.host, path: u.pathname, status: res.status() };
      report.api.push(row);
      console.log('[api]', JSON.stringify(row));
    }
  });
  page.on('pageerror', (e) => report.errors.push(`${label}: ${e.message}`));
}

const launcher = ENGINE === 'webkit' ? webkit : chromium;
const browser = await launcher.launch();
try {
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(CODE)) throw new Error('CODE (QA candidate code) is required');
  // 1) the candidate opens the personal link and types
  const ctx1 = await browser.newContext(profile);
  const p1 = await ctx1.newPage();
  watch(p1, 'first');
  await p1.goto(`${SITE}/apply/${CODE}`, { waitUntil: 'load', timeout: 60000 });
  const name1 = p1.locator('#applicationForm [name="fullName"]');
  await name1.waitFor({ state: 'visible', timeout: 30000 });
  await shot(p1, 'form-opened');
  await name1.click();
  await name1.fill('');
  await name1.type(TYPED, { delay: 30 });
  // autosave: the draft reaches the server at most every 4 s
  const saved = await p1.waitForResponse((r) => r.url().includes('/api/public/hiring/draft') && r.request().method() === 'POST', { timeout: 30000 })
    .then((r) => ({ status: r.status(), host: new URL(r.url()).host })).catch(() => null);
  report.checks.draftSaved = saved;
  await shot(p1, 'typed', { saved });
  await ctx1.close();

  // 2) another device: no local draft, the server draft brings the name back
  const ctx2 = await browser.newContext(profile);
  const p2 = await ctx2.newPage();
  watch(p2, 'second');
  await p2.goto(`${SITE}/apply/${CODE}`, { waitUntil: 'load', timeout: 60000 });
  const name2 = p2.locator('#applicationForm [name="fullName"]');
  await name2.waitFor({ state: 'visible', timeout: 30000 });
  await p2.waitForFunction((v) => {
    const el = document.querySelector('#applicationForm [name="fullName"]');
    return el && el.value === v;
  }, TYPED, { timeout: 20000 }).catch(() => {});
  report.checks.restoredFromServer = await name2.inputValue();
  await shot(p2, 'restored-on-another-device', { value: report.checks.restoredFromServer });

  // 3) the application endpoint answers on the site origin (honeypot: nothing is written)
  report.checks.applyEndpoint = await p2.evaluate(async () => {
    const r = await fetch('/api/public/hr/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hp: 'qa-careers-check' }) });
    return { status: r.status, body: await r.text() };
  });
  // 4) every script, form and asset on the page is on the site
  report.checks.pageNamesPlatform = await p2.evaluate((host) => document.documentElement.outerHTML.includes(host), PLATFORM_HOST);
  await ctx2.close();
} catch (e) {
  report.errors.push(e.message);
} finally {
  await browser.close();
}

const ok = report.platformRequests.length === 0
  && report.checks.draftSaved && report.checks.draftSaved.status === 204 && report.checks.draftSaved.host === new URL(SITE).host
  && report.checks.restoredFromServer === TYPED
  && report.checks.applyEndpoint && report.checks.applyEndpoint.status === 200
  && report.checks.pageNamesPlatform === false
  && report.api.every((a) => a.host === new URL(SITE).host && a.status < 400)
  && !report.steps.some((s) => s.overflow);
report.ok = !!ok;
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log('[report]', JSON.stringify({ ok: report.ok, platformRequests: report.platformRequests, checks: report.checks, hosts: report.hosts, errors: report.errors }));
process.exit(ok ? 0 : 1);
