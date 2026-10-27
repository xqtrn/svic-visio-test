// associate-orientation.mjs — the screens of the associate ORIENTATION lesson (2026-10-27),
// recorded on the live platform in a real browser (desktop Chromium or WebKit with an
// iPhone profile), signed in as a QA TEST CANDIDATE through its test link (no LinkedIn).
//
// Every section a new associate has after the setup, one screenshot per screen (a
// viewport shot for the video frame + the full page for QA) and the boxes of the
// controls the narration points at, so the video's cursor moves to the real buttons.
//
// Read-only: it opens pages and clicks only navigation, tabs and list rows. It never
// sends, books, publishes, takes a deal or saves a setting.
//
// Env: AJ_WELCOME (the test candidate's setup link, a secret set for the run and deleted
//      right after; the repository is public), ENGINE (webkit|chromium), ONLY (comma list
//      of step names to run; empty = all).
import { webkit, chromium } from 'playwright';
import fs from 'fs';

const WELCOME = (process.env.AJ_WELCOME || '').trim();
const ENGINE = process.env.ENGINE === 'webkit' ? 'webkit' : 'chromium';
const ONLY = new Set(String(process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean));
const BASE = 'https://platform.siliconvalleyinvestclub.com';
const OUT = 'out';
fs.mkdirSync(OUT, { recursive: true });
if (!WELCOME) throw new Error('AJ_WELCOME is empty');

const PROBE = fs.readFileSync('overrides/ds-spacing-probe.browser.js', 'utf8');
const report = { engine: ENGINE, steps: [], errors: [] };
let n = 0;
const phone = ENGINE === 'webkit';
const profile = phone
  ? { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }
  : { viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1.25 };

const browser = await (phone ? webkit : chromium).launch();
const ctx = await browser.newContext({ ...profile, timezoneId: 'America/New_York', locale: 'en-US', colorScheme: 'light' });
// A real candidate never sees the «Test candidate · Back to my account» strip: it is
// drawn by loader.js from the page-readable svic_qa_test cookie. Hide that one cookie
// from the page's scripts (the session itself is untouched), so every frame shows the
// platform exactly as a candidate sees it.
if (process.env.KEEP_QA_STRIP !== '1') await ctx.addInitScript(() => {
  const d = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  if (!d || !d.get) return;
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get() { return String(d.get.call(document)).split(/;\s*/).filter((c) => !/^svic_qa_test=/.test(c)).join('; '); },
    set(v) { d.set.call(document, v); },
  });
});
const page = await ctx.newPage();
page.on('pageerror', (e) => report.errors.push({ step: 'pageerror', url: safeUrl(page.url()), error: safeUrl(String(e)).slice(0, 300) }));
page.on('dialog', (d) => { report.errors.push({ step: 'native-dialog', error: d.message() }); d.dismiss().catch(() => {}); });
page.on('console', (m) => { if (m.type() === 'error') report.errors.push({ step: 'console', url: safeUrl(page.url()), error: safeUrl(m.text()).slice(0, 300) }); });
page.on('response', (r) => { if (r.status() >= 400 && /platform\.siliconvalleyinvestclub\.com\/api\//.test(r.url())) report.errors.push({ step: 'http' + r.status(), url: safeUrl(r.url()) }); });

function safeUrl(u) { return String(u || '').replace(/\/welcome\/[^/?#"\s]+/g, '/welcome/<token>').replace(/\/sign\/[^?#"\s]+/g, '/sign/<token>').replace(/[A-Za-z0-9_-]{40,}/g, '<token>'); }
const visible = (sel) => page.locator(sel).first().isVisible().catch(() => false);

async function boxes(sels) {
  return page.evaluate((list) => {
    const out = {};
    for (const s of list) {
      const el = document.querySelector(s);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height) out[s] = { x: Math.round(r.x + window.scrollX), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) };
    }
    return out;
  }, sels).catch(() => ({}));
}
async function shot(name, { targets = [], extra = {}, settle = 900 } = {}) {
  n += 1;
  const base = `${String(n).padStart(2, '0')}-${name}`;
  await page.waitForTimeout(settle);
  // the platform's own fonts, so a frame never shows a fallback face
  await page.evaluate(() => (document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true)).catch(() => {});
  const probe = await page.evaluate(() => ({
    url: location.host + location.pathname + location.search + location.hash,
    scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
    title: document.title,
    text: (document.body && document.body.innerText || '').replace(/\s+\n/g, '\n').slice(0, 6000),
  })).catch(() => ({}));
  probe.url = safeUrl(probe.url);
  probe.text = safeUrl(probe.text || '');
  await page.screenshot({ path: `${OUT}/${base}.png` }).catch(() => {});
  await Promise.race([page.screenshot({ path: `${OUT}/${base}-full.png`, fullPage: true }), new Promise((r) => setTimeout(r, 20000))]).catch(() => {});
  const spacing = await page.evaluate(PROBE).catch((e) => ({ error: String(e).slice(0, 120) }));
  const step = { n, name, file: `${base}.png`, ...probe, overflow: probe.scrollWidth > probe.innerWidth + 1, boxes: await boxes(targets), spacing, ...extra };
  report.steps.push(step);
  console.log('[shot]', JSON.stringify({ ...step, text: undefined, spacing: undefined }));
  return step;
}
async function step(name, fn) {
  if (ONLY.size && name !== 'sign-in' && !ONLY.has(name)) return;
  try { await fn(); } catch (e) {
    report.errors.push({ step: name, error: safeUrl(String(e)).slice(0, 1600) });
    console.log('[error]', name, safeUrl(String(e)).slice(0, 400));
    await shot(`${name}-error`).catch(() => {});
  }
}
async function go(path, waitSel, name, opts = {}) {
  await page.goto(path.startsWith('http') ? path : BASE + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (waitSel) await page.waitForSelector(waitSel, { timeout: opts.timeout || 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  // the Your path strip mounts after /api/nav: wait for it where the person has one
  if (opts.strip !== false) await page.waitForSelector('#yourPath', { timeout: 8000 }).catch(() => {});
  return shot(name, opts);
}
// The menu: the burger on a phone, the top-bar «More» / burger on a desktop.
async function openMenu() {
  const burger = page.locator('.tb-burger, #menuButton, [aria-label*="menu" i]').first();
  if (await burger.isVisible().catch(() => false)) { await burger.click(); await page.waitForTimeout(900); return true; }
  return false;
}
async function closeOverlays() { await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(300); }

let mailHref = '/mailbox';
let deskHref = null;
try {
  await step('sign-in', async () => {
    await page.goto(WELCOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#btnTestSignIn', { timeout: 30000 });
    await Promise.all([page.waitForURL(/\/(onboarding|mailbox|training)/, { timeout: 60000 }), page.click('#btnTestSignIn')]);
    const nav = await page.evaluate(async () => (await fetch('/api/nav', { credentials: 'include' })).json()).catch(() => null);
    report.nav = nav ? { menu: nav.menu, path: nav.path, landing: nav.landing } : null;
    const items = nav ? [...(nav.menu.pinned || []), ...(nav.menu.groups || []).flatMap((g) => g.items || [])] : [];
    const mail = items.find((i) => i.id === 'mailbox'); if (mail) mailHref = mail.href;
    const desk = items.find((i) => i.id === 'messengerdesk'); if (desk) deskHref = desk.href;
  });

  await step('orientation', async () => {
    await go('/training/orientation', 'main', 'orientation', { targets: ['#orFrame', '#orSkip', '#orGo', '#yourPath', '#pathNext'], settle: 2500 });
  });
  await step('my-path', async () => {
    await go('/my-path', '#ppGrid .path-card h3', 'my-path', { targets: ['#yourPath', '#pathNext', '#ppSetup', '#ppFinalis', '#ppExams', '#ppDesk', '#ppGo', '.path-strip-steps'], settle: 1500 });
  });
  await step('mail', async () => {
    await go(mailHref, '.mrow, .mb-empty, .empty, main', 'mail-inbox', { targets: ['#yourPath', '#pathNext', '.mrow', '#composeBtn', '.mb-compose', '[data-settings-open]', 'a[href="#settings"]'], timeout: 45000, settle: 2500 });
    const row = page.locator('.mrow').first();
    if (await row.isVisible().catch(() => false)) {
      await row.click();
      await page.waitForTimeout(2500);
      await shot('mail-letter', { targets: ['.msg-subj', '.msg-body', '.att, .attachment'] });
    }
    // Settings open from the hash once the mailbox app is up (a cold load with the hash stays on the inbox).
    await page.evaluate(() => { location.hash = '#settings/signatures'; });
    await page.waitForTimeout(2500);
    if (!(await visible('[data-settings-group="signature"]'))) { await page.evaluate(() => { location.hash = ''; location.hash = '#settings/signatures'; }); await page.waitForTimeout(2500); }
    await shot('mail-signature', { targets: ['[data-settings-group="signature"]', '#settingsPanel', '.sig-preview'], settle: 3000 });
  });
  await step('scheduling', async () => {
    await go('/scheduling', '#setupLink, .sch-console-grid, main', 'scheduling', { targets: ['#setupLink', '.sch-console-grid', '#publishBtn', '[data-step]'], timeout: 45000, settle: 3000 });
  });
  await step('messenger', async () => {
    await go(deskHref || '/messengers', 'main, body', 'messenger', { timeout: 45000, settle: 4000 });
  });
  await step('group-calls', async () => {
    await go('/group-calls', 'main, body', 'group-calls', { timeout: 45000, settle: 4000 });
  });
  await step('exam-prep', async () => {
    await go('/training/exam-prep', '#xpExam, main', 'exam-prep', { targets: ['#xpExam', '#xpStudy', '#xpExam [data-exam="SIE"]', '[data-read]'], settle: 2500 });
    await go('/training/exam-prep?exam=SIE', '#xpExam, main', 'exam-prep-sie', { targets: ['#xpExam', '#xpStudy', '[data-read]', '[data-practice]', '[data-sim]'], settle: 2500 });
    await go('/training/exam-prep?exam=SIE&lesson=sie-1-1', 'main', 'exam-prep-lesson', { settle: 3000 });
  });
  await step('desk', async () => {
    await go('/candidate-preview', 'body', 'desk-marketplace', { targets: ['.ds-sealed', '.market-table', '.market-row'], settle: 4500 });
    await go('/desk/matches', 'body', 'desk-matches', { targets: ['#convo .td-pair-row .nm', '#coList .co-item', '#tdTake'], settle: 4500 });
    const row = page.locator('#convo .td-pair-row .nm >> visible=true').first();
    const item = (await row.isVisible().catch(() => false)) ? row : page.locator('#coList .co-item').first();
    if (await item.isVisible().catch(() => false)) { await item.click(); await shot('desk-matches-open', { targets: ['#tdTake', '.ds-sealed'], settle: 2500 }); }
    await go('/desk/order-book', 'body', 'desk-order-book', { targets: ['#coList .co-item'], settle: 4500 });
    const ob = page.locator('#coList .co-item').first();
    if (await ob.isVisible().catch(() => false)) { await ob.click(); await shot('desk-order-book-open', { targets: ['.ds-sealed'], settle: 2500 }); }
    await go('/desk/pipeline', 'body', 'desk-pipeline', { settle: 3500 });
    await go('/desk/clients', 'body', 'desk-clients', { settle: 3500 });
  });
  await step('account', async () => {
    await go('/my-account', 'main, body', 'my-account', { settle: 3000 });
    await go('/signin-methods', 'main, body', 'signin-methods', { settle: 3000 });
  });
  await step('menu', async () => {
    await go('/my-path', '#ppGrid .path-card h3', 'menu-closed', { settle: 1500 });
    if (await openMenu()) await shot('menu-open', { targets: ['a[href="/training/orientation"]', 'a[href="/training/exam-prep"]'], settle: 1200 });
    await closeOverlays();
  });
  report.path = await page.evaluate(async () => (await fetch('/api/my-path', { credentials: 'include' })).json()).catch(() => null);
} catch (e) {
  report.fatal = safeUrl(String(e)).slice(0, 400);
} finally {
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  await browser.close();
}
console.log('[done]', report.steps.length, 'shots,', report.errors.length, 'errors', report.fatal ? 'FATAL ' + report.fatal : '');
