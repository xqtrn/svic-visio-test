// recruiter-journey.mjs — a new recruiter's whole first day on the platform, in a
// real browser (Playwright WebKit with an iPhone profile, or desktop Chromium),
// one screenshot per screen. Drives a QA recruiter account only: the session
// cookie comes from a short-lived secret that is deleted right after the run.
//
// PHASE (the journey pauses where the platform waits on the outside world):
//   a — Account → Details (Canada, Quebec) → Agreement: opens the signing page
//   b — signs and presses Finish → Training plays → Hours → Zoom (waiting)
//   c — Zoom ready → setup complete → a test candidate books a 15-minute call →
//       the booking on Interviews → call card → presentation tour → Report
// Env: BASE, ENGINE (webkit|chromium), PHASE, RJ_COOKIE (svic_token=…), SLUG,
//      CANDIDATE_NAME, CANDIDATE_EMAIL (a mailbox we own).
import { webkit, chromium } from 'playwright';
import fs from 'fs';

const BASE = (process.env.BASE || 'https://platform.siliconvalleyinvestclub.com').replace(/\/$/, '');
const ENGINE = process.env.ENGINE === 'chromium' ? 'chromium' : 'webkit';
const PHASE = process.env.PHASE || 'a';
const SLUG = process.env.SLUG || 'qa-recruiter';
const CANDIDATE_NAME = process.env.CANDIDATE_NAME || 'QA Candidate';
const CANDIDATE_EMAIL = process.env.CANDIDATE_EMAIL || '';
const COOKIE = (process.env.RJ_COOKIE || '').trim();
const host = new URL(BASE).hostname;
const OUT = 'out';
fs.mkdirSync(OUT, { recursive: true });

const report = { engine: ENGINE, phase: PHASE, steps: [], errors: [] };
let n = 0;
const profile = ENGINE === 'webkit'
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }
  : { viewport: { width: 1440, height: 900 } };

async function shot(page, name, extra = {}) {
  n += 1;
  const file = `${String(n).padStart(2, '0')}-${name}.png`;
  await page.waitForTimeout(600);
  const probe = await page.evaluate(() => ({
    url: location.pathname + location.search,
    scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
    title: document.title,
  })).catch(() => ({}));
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true }).catch(() => page.screenshot({ path: `${OUT}/${file}` }));
  const step = { n, name, file, ...probe, overflow: probe.scrollWidth > probe.innerWidth + 1, ...extra };
  report.steps.push(step);
  console.log('[shot]', JSON.stringify(step));
  return step;
}
async function step(name, fn) {
  try { await fn(); } catch (e) { report.errors.push({ step: name, error: String(e).slice(0, 400) }); console.log('[error]', name, String(e).slice(0, 400)); throw e; }
}

const engine = ENGINE === 'webkit' ? webkit : chromium;
const browser = await engine.launch();
const ctx = await browser.newContext(profile);
if (COOKIE) {
  const [name, ...rest] = COOKIE.split('=');
  await ctx.addCookies([{ name, value: rest.join('='), domain: host, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
}
const page = await ctx.newPage();
page.on('pageerror', (e) => report.errors.push({ step: 'pageerror', url: page.url(), error: String(e).slice(0, 300) }));
page.on('dialog', (d) => { report.errors.push({ step: 'native-dialog', error: d.message() }); d.dismiss().catch(() => {}); });
const api = (path) => page.evaluate(async (p) => { const r = await fetch(p, { credentials: 'include' }); return { status: r.status, body: await r.json().catch(() => null) }; }, path);
const visible = (sel) => page.locator(sel).first().isVisible().catch(() => false);

try {
  if (PHASE === 'a') {
    await step('account', async () => {
      await page.goto(`${BASE}/onboarding`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.ob-panel.on[data-step="1"], .ob-panel.on[data-step="2"]', { timeout: 30000 });
      await shot(page, 'account');
      if (await visible('#btnSkip1')) await page.click('#btnSkip1');
    });
    await step('details', async () => {
      await page.waitForSelector('.ob-panel.on[data-step="2"]', { timeout: 15000 });
      await shot(page, 'details-empty');
      await page.selectOption('#ctry', 'CA');
      await page.selectOption('#st', 'Quebec');
      await page.fill('#ph', '(514) 555-0142');
      await page.fill('#city', 'Montreal');
      // A real image for the photo: a rendered swatch of this very page.
      const png = await page.screenshot({ clip: { x: 0, y: 0, width: 240, height: 240 } });
      await page.setInputFiles('#photoFile', { name: 'qa-photo.png', mimeType: 'image/png', buffer: png });
      await page.waitForSelector('#photoTag:not([hidden])', { timeout: 20000 });
      await shot(page, 'details-filled');
      await page.click('#btnDetails');
    });
    await step('agreement', async () => {
      await page.waitForSelector('.ob-panel.on[data-step="3"]', { timeout: 20000 });
      await shot(page, 'agreement');
      await Promise.all([page.waitForURL(/\/sign\//, { timeout: 45000 }), page.click('#btnSign')]);
      await page.waitForSelector('#step-consent:not([hidden]), #gate:not([hidden])', { timeout: 30000 });
      await shot(page, 'sign-consent');
    });
  }

  if (PHASE === 'b') {
    await step('sign', async () => {
      await page.goto(`${BASE}/onboarding?step=agreement`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.ob-panel.on[data-step="3"]', { timeout: 30000 });
      await Promise.all([page.waitForURL(/\/sign\//, { timeout: 45000 }), page.click('#btnSign')]);
      await page.waitForSelector('#step-consent:not([hidden]), #step-sign:not([hidden]), #gate:not([hidden])', { timeout: 30000 });
      if (await visible('#gate')) { await shot(page, 'sign-gate'); throw new Error('signing page shows a gate: ' + (await page.textContent('#gate'))); }
      if (await visible('#step-consent')) { await page.check('#consentChk'); await page.click('#consentBtn'); }
      await page.waitForSelector('#actionbar:not([hidden]) #nextBtn', { timeout: 30000 });
      await page.waitForSelector('.fw', { timeout: 30000 });
      await shot(page, 'sign-document');
      for (let i = 0; i < 12; i++) {
        if (await visible('.modal-hd')) {
          await page.click('#t-type');
          await page.fill('#typedName', 'QA Recruiter');
          await shot(page, 'sign-adopt-modal');
          await page.click('text=Adopt and sign');
          await page.waitForTimeout(500);
          continue;
        }
        const label = (await page.textContent('#nextBtn')) || '';
        if (/Finish/.test(label)) break;
        await page.click('#nextBtn');
        await page.waitForTimeout(500);
      }
      await shot(page, 'sign-ready-to-finish');
      await Promise.all([page.waitForURL(/\/onboarding/, { timeout: 45000 }), page.click('#nextBtn')]);
      await page.waitForSelector('.ob-panel.on[data-step="3"], .ob-panel.on[data-step="4"]', { timeout: 30000 });
      await shot(page, 'agreement-signed', { agreement: (await api('/api/onboarding')).body?.agreement?.state });
    });
    await step('training', async () => {
      if (await visible('#btnAgNext')) await page.click('#btnAgNext');
      await page.waitForSelector('.ob-panel.on[data-step="4"]', { timeout: 15000 });
      await shot(page, 'training-step');
      const [player] = await Promise.all([ctx.waitForEvent('page', { timeout: 20000 }), page.click('#btnTrain')]);
      await player.waitForLoadState('domcontentloaded');
      await player.waitForTimeout(4000);
      await player.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-training-player-open.png` });
      report.steps.push({ n, name: 'training-player-open', file: `${String(n).padStart(2, '0')}-training-player-open.png`, url: new URL(player.url()).pathname });
      // Press play the way a person does: the first visible play control, else the video itself.
      const play = player.locator('button:has-text("Play"), [aria-label*="Play" i], .play, #play').first();
      if (await play.isVisible().catch(() => false)) await play.click().catch(() => {});
      else await player.locator('video').first().click().catch(() => {});
      await player.waitForTimeout(6000);
      const media = await player.evaluate(() => [...document.querySelectorAll('video,audio')].map((m) => ({ t: m.currentTime, paused: m.paused, err: m.error && m.error.code }))).catch(() => []);
      await player.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-training-player-playing.png` });
      report.steps.push({ n, name: 'training-player-playing', file: `${String(n).padStart(2, '0')}-training-player-playing.png`, media });
      await player.close();
      await page.bringToFront();
      await page.waitForTimeout(1500);
      const tr = (await api('/api/onboarding')).body?.training;
      await shot(page, 'training-back', { trainingViewedAt: tr && tr.viewedAt, media });
      await page.click('#btnTrainNext');
    });
    await step('hours', async () => {
      await page.waitForSelector('.ob-panel.on[data-step="5"]', { timeout: 15000 });
      await shot(page, 'hours-empty');
      const rows = page.locator('.ob-hrow[data-day] input[type=checkbox]');
      const count = await rows.count();
      for (let i = 0; i < count; i++) await rows.nth(i).check();
      await shot(page, 'hours-set');
      await page.click('#btnHours');
      await page.waitForSelector('.ob-panel.on[data-step="6"]', { timeout: 20000 });
    });
    await step('zoom-waiting', async () => {
      await shot(page, 'zoom-waiting');
      await page.click('#btnZoomCheck');
      await page.waitForTimeout(5000);
      await shot(page, 'zoom-after-check', { zoom: (await api('/api/onboarding')).body?.zoom?.readyAt || null });
    });
  }

  if (PHASE === 'c') {
    await step('zoom-ready', async () => {
      await page.goto(`${BASE}/onboarding?step=zoom`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.ob-panel.on[data-step="6"], .ob-panel.on[data-step="7"]', { timeout: 30000 });
      await shot(page, 'zoom-ready');
      if (await visible('#btnZoom')) await page.click('#btnZoom');
      await page.waitForSelector('.ob-panel.on[data-step="7"]', { timeout: 20000 });
      await shot(page, 'setup-complete');
    });
    await step('candidate-books', async () => {
      const cand = await browser.newContext(profile);
      const cp = await cand.newPage();
      cp.on('pageerror', (e) => report.errors.push({ step: 'candidate-pageerror', error: String(e).slice(0, 300) }));
      await cp.goto(`${BASE}/schedule/${SLUG}`, { waitUntil: 'domcontentloaded' });
      await cp.waitForTimeout(3000);
      await cp.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-booking-page.png`, fullPage: true });
      report.steps.push({ n, name: 'booking-page', file: `${String(n).padStart(2, '0')}-booking-page.png` });
      const ev = cp.locator('text=Intro Call — Private Markets Associate').first();
      if (await ev.isVisible().catch(() => false) && !(await cp.locator('.sch-day').count())) await ev.click();
      await cp.waitForSelector('.sch-day', { timeout: 30000 });
      const days = cp.locator('button.sch-day:not([disabled])');
      let picked = false;
      for (let i = 0; i < Math.min(await days.count(), 14) && !picked; i++) {
        await days.nth(i).click();
        await cp.waitForTimeout(1200);
        if (await cp.locator('button.sch-slot').count()) picked = true;
      }
      if (!picked) throw new Error('no bookable slot found');
      await cp.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-booking-slots.png`, fullPage: true });
      report.steps.push({ n, name: 'booking-slots', file: `${String(n).padStart(2, '0')}-booking-slots.png` });
      await cp.locator('button.sch-slot').first().click();
      await cp.locator('button.sch-slot-confirm').first().click();
      await cp.waitForSelector('#inviteeName', { timeout: 20000 });
      await cp.fill('#inviteeName', CANDIDATE_NAME);
      await cp.fill('#inviteeEmail', CANDIDATE_EMAIL);
      if (await cp.locator('#schTerms').count()) await cp.check('#schTerms');
      await cp.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-booking-form.png`, fullPage: true });
      report.steps.push({ n, name: 'booking-form', file: `${String(n).padStart(2, '0')}-booking-form.png` });
      await cp.click('button:has-text("Schedule event")');
      await cp.waitForTimeout(6000);
      await cp.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-booking-confirmed.png`, fullPage: true });
      report.steps.push({ n, name: 'booking-confirmed', file: `${String(n).padStart(2, '0')}-booking-confirmed.png`, url: new URL(cp.url()).pathname, text: (await cp.textContent('body')).replace(/\s+/g, ' ').slice(0, 400) });
      await cand.close();
    });
    await step('interviews', async () => {
      await page.goto(`${BASE}/interviews`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      await shot(page, 'interviews-list');
      const row = page.locator('#ivRows tr').filter({ hasText: CANDIDATE_NAME }).first();
      await row.click();
      await page.waitForTimeout(3000);
      await shot(page, 'call-card');
      await page.waitForTimeout(4000);
      await shot(page, 'call-card-timer');
    });
    await step('presentation', async () => {
      await Promise.all([page.waitForURL(/\/desk\/network/, { timeout: 30000 }), page.click('a:has-text("Start presentation")')]);
      await page.waitForTimeout(4000);
      await shot(page, 'present-network');
      for (const [name, path] of [['present-marketplace', '/marketplaceadmin'], ['present-matches', '/desk/matches'], ['present-pipeline', '/desk/pipeline'],
        ['present-orderbook', '/desk/order-book'], ['present-clients', '/desk/clients'], ['present-mailbox', '/mailbox'], ['present-messengers', '/messengers'], ['present-scheduling', '/scheduling']]) {
        await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(4500);
        await shot(page, name, { strip: await visible('.svic-present-x') });
      }
      await Promise.all([page.waitForURL(/\/interviews/, { timeout: 30000 }), page.click('a.svic-present-x')]);
      await page.waitForTimeout(3500);
      await shot(page, 'present-ended-back-on-card');
    });
    await step('report', async () => {
      await page.goto(`${BASE}/interviews/report`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      await shot(page, 'report');
    });
  }
} catch (e) {
  await shot(page, 'failure').catch(() => {});
} finally {
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  await browser.close();
  console.log('[done]', report.errors.length ? 'ERRORS ' + report.errors.length : 'CLEAN');
}
