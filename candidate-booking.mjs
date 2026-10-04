// candidate-booking.mjs — a candidate's booking path on the SITE domain, in a
// real browser (Playwright WebKit with an iPhone profile, or desktop Chromium),
// one screenshot per screen (Arthur 2026-10-04: platform.* is internal only).
//
// PHASE
//   book   — letter link SITE/meet/<CODE> → booking page on the site → day →
//            time → Next → details (pre-filled from the application, editable)
//            → Confirm booking → success; then the booking on the QA recruiter's
//            Interviews page (platform, staff session) with the application.
//   cancel — the Cancel link from the confirmation email (CANCEL_URL, on the
//            site) → Cancel meeting → canceled.
// Every request the CANDIDATE's browser makes is recorded: none may go to the
// platform host. Env: SITE, PLATFORM, ENGINE, PHASE, CODE, CANDIDATE_NAME,
// CANDIDATE_EMAIL, CANCEL_URL, RJ_COOKIE (svic_token=… — QA recruiter, deleted
// right after the run).
import { webkit, chromium } from 'playwright';
import fs from 'fs';

const SITE = (process.env.SITE || 'https://siliconvalleyinvestclub.com').replace(/\/$/, '');
const PLATFORM = (process.env.PLATFORM || 'https://platform.siliconvalleyinvestclub.com').replace(/\/$/, '');
const ENGINE = process.env.ENGINE === 'chromium' ? 'chromium' : 'webkit';
const PHASE = process.env.PHASE || 'book';
const CODE = process.env.CODE || '';
const CANDIDATE_NAME = process.env.CANDIDATE_NAME || 'QA Candidate';
const CANDIDATE_EMAIL = process.env.CANDIDATE_EMAIL || '';
const CANCEL_URL = process.env.CANCEL_URL || '';
const COOKIE = (process.env.RJ_COOKIE || '').trim();
const OUT = 'out';
fs.mkdirSync(OUT, { recursive: true });

const report = { engine: ENGINE, phase: PHASE, steps: [], errors: [], candidateHosts: {}, checks: {} };
let n = 0;
const profile = ENGINE === 'webkit'
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }
  : { viewport: { width: 1440, height: 900 } };

async function shot(page, name, extra = {}) {
  n += 1;
  const file = `${String(n).padStart(2, '0')}-${name}.png`;
  await page.waitForTimeout(700);
  const probe = await page.evaluate(() => ({
    url: location.origin + location.pathname + location.search,
    scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, title: document.title,
  })).catch(() => ({}));
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true }).catch(() => page.screenshot({ path: `${OUT}/${file}` }));
  const step = { n, name, file, ...probe, overflow: probe.scrollWidth > probe.innerWidth + 1, ...extra };
  report.steps.push(step);
  console.log('[shot]', JSON.stringify(step));
  return step;
}
async function step(name, fn) {
  try { await fn(); } catch (e) { report.errors.push({ step: name, error: String(e).slice(0, 500) }); console.log('[error]', name, String(e).slice(0, 500)); throw e; }
}

const engine = ENGINE === 'webkit' ? webkit : chromium;
const browser = await engine.launch();
const cand = await browser.newContext(profile);
const cp = await cand.newPage();
cp.on('request', (r) => { try { const h = new URL(r.url()).hostname; report.candidateHosts[h] = (report.candidateHosts[h] || 0) + 1; } catch (_) {} });
cp.on('pageerror', (e) => report.errors.push({ step: 'candidate-pageerror', url: cp.url(), error: String(e).slice(0, 300) }));
cp.on('dialog', (d) => { report.errors.push({ step: 'native-dialog', error: d.message() }); d.dismiss().catch(() => {}); });

try {
  if (PHASE === 'book') {
    await step('letter-link', async () => {
      const redirects = [];
      cp.on('response', (r) => { if (r.status() >= 300 && r.status() < 400) redirects.push({ url: r.url(), status: r.status(), location: r.headers().location || '' }); });
      await cp.goto(`${SITE}/meet/${CODE}`, { waitUntil: 'domcontentloaded' });
      await cp.waitForSelector('.sch-day', { timeout: 45000 });
      report.checks.redirects = redirects;
      report.checks.landed = cp.url();
      report.checks.landedOnSite = cp.url().startsWith(`${SITE}/schedule/`);
      report.checks.topbars = await cp.evaluate(() => ({ siteTopbar: document.querySelectorAll('header.topbar').length, guestBar: document.querySelectorAll('header.guest-bar').length }));
      await shot(cp, 'booking-page');
    });
    await step('pick-time', async () => {
      const days = cp.locator('button.sch-day:not([disabled])');
      let picked = false;
      for (let i = 0; i < Math.min(await days.count(), 20) && !picked; i++) {
        await days.nth(i).click();
        await cp.waitForTimeout(1200);
        if (await cp.locator('button.sch-slot').count()) picked = true;
      }
      if (!picked) throw new Error('no bookable slot found');
      await shot(cp, 'times');
      // the LAST time of the day: the person has scrolled down a long list
      const last = cp.locator('button.sch-slot').last();
      await last.scrollIntoViewIfNeeded();
      await last.click();
      await cp.waitForSelector('button.sch-slot-confirm', { timeout: 10000 });
      report.checks.armedLabel = (await cp.locator('button.sch-slot-confirm').first().textContent()).trim();
      await shot(cp, 'time-armed');
      await cp.locator('button.sch-slot-confirm').first().click();
    });
    await step('details', async () => {
      await cp.waitForSelector('#inviteeName', { timeout: 20000 });
      await cp.waitForTimeout(1500);
      report.checks.detailsInView = await cp.evaluate(() => {
        const h = document.querySelector('.sch-stage-head h2').getBoundingClientRect();
        const bar = document.querySelector('header.topbar');
        const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
        return { headTop: Math.round(h.top), barBottom: Math.round(barBottom), innerHeight, visible: h.top >= barBottom && h.bottom <= innerHeight };
      });
      await cp.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-details-viewport.png` });
      report.steps.push({ n, name: 'details-viewport', file: `${String(n).padStart(2, '0')}-details-viewport.png` });
      report.checks.prefill = { name: await cp.inputValue('#inviteeName'), email: await cp.inputValue('#inviteeEmail') };
      report.checks.prefillOk = report.checks.prefill.name === CANDIDATE_NAME && report.checks.prefill.email === CANDIDATE_EMAIL;
      report.checks.detailsHeading = (await cp.locator('.sch-stage-head h2').first().textContent()).trim();
      report.checks.submitLabel = (await cp.locator('.sch-form button[type=submit]').first().textContent()).trim();
      report.checks.successBeforeSubmit = await cp.locator('.sch-success').count();
      await shot(cp, 'details-prefilled');
      if (await cp.locator('#schTerms').count()) await cp.check('#schTerms');
    });
    await step('confirm', async () => {
      const resp = cp.waitForResponse((r) => /\/api\/scheduling\/public\/[^/]+\/[^/]+\/bookings$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST', { timeout: 45000 });
      await cp.click('button:has-text("Confirm booking")');
      const r = await resp;
      const body = await r.json().catch(() => null);
      report.checks.bookingResponse = { status: r.status(), url: r.url(), booking: body && body.booking ? { id: body.booking.id, status: body.booking.status, startsAt: body.booking.startsAt, inviteeEmail: body.booking.inviteeEmail } : body };
      await cp.waitForSelector('.sch-success h2', { timeout: 45000 });
      report.checks.firstSuccessTitle = (await cp.locator('.sch-success h2').first().textContent()).trim();
      if (report.checks.firstSuccessTitle !== 'You are scheduled') await shot(cp, 'booking-received');
      // the page itself polls the booking until the platform confirms it
      await cp.waitForFunction(() => /You are scheduled/.test((document.querySelector('.sch-success h2') || {}).textContent || ''), null, { timeout: 30000 }).catch(() => {});
      report.checks.successTitle = (await cp.locator('.sch-success h2').first().textContent()).trim();
      await shot(cp, 'success');
    });
  }
  if ((PHASE === 'book' || PHASE === 'interviews') && COOKIE) {
    {
      await step('interviews', async () => {
        const staff = await browser.newContext(profile);
        const [name, ...rest] = COOKIE.split('=');
        await staff.addCookies([{ name, value: rest.join('='), domain: new URL(PLATFORM).hostname, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
        const page = await staff.newPage();
        page.on('pageerror', (e) => report.errors.push({ step: 'staff-pageerror', error: String(e).slice(0, 400) }));
        page.on('console', (m) => { if (m.type() === 'error') report.errors.push({ step: 'staff-console', error: m.text().slice(0, 300) }); });
        page.on('response', (r) => { if (/\/api\/interviews/.test(r.url())) (report.checks.staffApi = report.checks.staffApi || []).push(r.status() + ' ' + new URL(r.url()).pathname); });
        await page.goto(`${PLATFORM}/interviews`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#ivRows tr', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2500);
        await shot(page, 'interviews-list');
        const row = page.locator('#ivRows tr').filter({ hasText: CANDIDATE_NAME }).first();
        report.checks.interviewsRow = (await row.count()) ? (await row.textContent()).replace(/\s+/g, ' ').trim().slice(0, 200) : null;
        if (await row.count()) {
          await row.click();
          await page.waitForFunction(() => !/Opening the call/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
          await page.waitForTimeout(2500);
          await shot(page, 'call-card');
          report.checks.callCardText = (await page.textContent('body')).replace(/\s+/g, ' ').slice(0, 600);
        }
        await staff.close();
      });
    }
  }
  if (PHASE === 'cancel') {
    await step('cancel-page', async () => {
      await cp.goto(CANCEL_URL, { waitUntil: 'domcontentloaded' });
      await cp.waitForSelector('.sch-stage-head h2, .sch-inline-status', { timeout: 45000 });
      report.checks.landed = cp.url();
      await shot(cp, 'cancel-page');
      await cp.click('button:has-text("Cancel meeting")');
      await cp.waitForSelector('.banner.ok', { timeout: 30000 });
      await shot(cp, 'canceled');
    });
  } else if (PHASE === 'open') {
    // The letter link opens the booking page on the site and nothing is booked.
    await step('open', async () => {
      await cp.goto(`${SITE}/meet/${CODE}`, { waitUntil: 'domcontentloaded' });
      await cp.waitForSelector('.sch-day', { timeout: 45000 });
      report.checks.landed = cp.url();
      await shot(cp, 'booking-page');
    });
  }
} catch (_) { /* recorded */ }
report.checks.platformRequestsFromCandidate = Object.keys(report.candidateHosts).filter((h) => /(^|\.)platform\.siliconvalleyinvestclub\.com$/.test(h)).length;
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.checks, null, 2));
await browser.close();
process.exit(report.errors.filter((e) => e.step !== 'candidate-pageerror').length ? 1 : 0);
