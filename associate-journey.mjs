// associate-journey.mjs — a new associate's whole path after Serge's yes, on the live
// platform, in a real browser (Playwright WebKit with an iPhone profile, or desktop
// Chromium): the setup link → four setup steps (with the real e-signature) → the
// welcome window → Your path → every section in the menu. One screenshot per screen
// (viewport shot for the video frame + full page for QA) and the boxes of the
// controls the person presses, so the narrated video can move its cursor to them.
//
// Drives a QA TEST CANDIDATE only (hr application source = 'qa'): its setup link
// opens the platform's test sign-in (no LinkedIn). The link comes from a secret
// that is deleted right after the run; the repository is public.
//
// Env: AJ_WELCOME (the test candidate's setup link), ENGINE (webkit|chromium),
//      SIGN_NAME (the typed signature), PHASE (all|platform).
import { webkit, chromium } from 'playwright';
import fs from 'fs';

const WELCOME = (process.env.AJ_WELCOME || '').trim();
const ENGINE = process.env.ENGINE === 'webkit' ? 'webkit' : 'chromium';
const PHASE = process.env.PHASE || 'all';
const SIGN_NAME = process.env.SIGN_NAME || 'Test Candidate';
// NOTYPE=1 (2026-10-25, Arthur: a test candidate's setup walks through with Continue only):
// nothing is typed — the Details fields and the photo come prefilled by the platform,
// the typed signature comes prefilled with the signer's name; the run fails if any is empty.
// It also checks the new-member photo gate: before the photo, any other page leads to /my-photo.
const NOTYPE = process.env.NOTYPE === '1';
const BASE = 'https://platform.siliconvalleyinvestclub.com';
const OUT = 'out';
fs.mkdirSync(OUT, { recursive: true });
if (!WELCOME && PHASE === 'all') throw new Error('AJ_WELCOME is empty');

// scripts/ds-spacing-probe.browser.js of the platform (the passport's spacing-probe), run on every screen
const PROBE = fs.readFileSync('overrides/ds-spacing-probe.browser.js', 'utf8');
const report = { engine: ENGINE, phase: PHASE, steps: [], errors: [] };
let n = 0;
const profile = ENGINE === 'webkit'
  ? { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }
  : { viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1.25 };

const engine = ENGINE === 'webkit' ? webkit : chromium;
const browser = await engine.launch();
const ctx = await browser.newContext({ ...profile, timezoneId: 'America/New_York', locale: 'en-US' });
// OVERRIDE=1: the platform's pages that this deploy changes are served from
// overrides/associate (the branch's public/ files), everything else is live —
// a real-browser check of the new front end on live data before it ships.
if (process.env.OVERRIDE === '1') {
  const dir = 'overrides/associate';
  const file = (f, type) => ({ status: 200, contentType: type, body: fs.readFileSync(`${dir}/${f}`) });
  await ctx.route(/^https:\/\/platform\.siliconvalleyinvestclub\.com\/(loader\.js|onboarding-associate\.js|onboarding\.css)(\?.*)?$/, (route, req) => {
    const f = new URL(req.url()).pathname.slice(1);
    route.fulfill(file(f, f.endsWith('.css') ? 'text/css' : 'application/javascript'));
  });
  await ctx.route(/^https:\/\/siliconvalleyinvestclub\.com\/__scheduler\/schedule\.js(\?.*)?$/, (route) => route.fulfill(file('schedule.js', 'application/javascript')));
  await ctx.route((url) => url.hostname === 'platform.siliconvalleyinvestclub.com', async (route, req) => {
    if (req.resourceType() !== 'document') return route.fallback();
    const p = new URL(req.url()).pathname;
    const map = [[/^\/onboarding\/?$/, 'onboarding.html'], [/^\/desk\//, 'trade-desk.html'], [/^\/mailbox(\/|$)/, 'mailbox.html'], [/^\/signature-setup\/?$/, 'signature-setup.html']];
    const hit = map.find(([re]) => re.test(p));
    if (!hit || req.method() !== 'GET') return route.fallback();
    const live = await route.fetch();
    // The server sent this page elsewhere (the photo gate → /onboarding): let the browser
    // follow the real redirect instead of drawing the override at the old address.
    if (new URL(live.url()).pathname !== p) return route.fallback();
    if (live.status() !== 200) return route.fulfill({ response: live });
    const headers = { ...live.headers(), 'content-type': 'text/html; charset=utf-8' };
    delete headers['content-length']; delete headers['content-encoding']; delete headers['transfer-encoding'];
    return route.fulfill({ status: 200, body: fs.readFileSync(`${dir}/${hit[1]}`, 'utf8'), headers });
  });
  report.override = true;
}
const page = await ctx.newPage();
page.on('pageerror', (e) => report.errors.push({ step: 'pageerror', url: safeUrl(page.url()), error: safeUrl(String(e)).slice(0, 300) }));
page.on('dialog', (d) => { report.errors.push({ step: 'native-dialog', error: d.message() }); d.dismiss().catch(() => {}); });
page.on('console', (m) => { if (m.type() === 'error') report.errors.push({ step: 'console', url: safeUrl(page.url()), error: safeUrl(m.text()).slice(0, 300) }); });
page.on('response', (r) => { if (r.status() >= 400 && /platform\.siliconvalleyinvestclub\.com\/api\//.test(r.url())) report.errors.push({ step: 'http' + r.status(), url: safeUrl(r.url()) }); });
page.on('response', (r) => { if (r.status() >= 500 && /siliconvalleyinvestclub\.com/.test(r.url())) report.errors.push({ step: 'http5xx', url: safeUrl(r.url()), status: r.status() }); });

function safeUrl(u) { return String(u || '').replace(/\/welcome\/[^/?#"\s]+/g, '/welcome/<token>').replace(/\/sign\/[^?#"\s]+/g, '/sign/<token>').replace(/[A-Za-z0-9_-]{40,}/g, '<token>'); }
const visible = (sel) => page.locator(sel).first().isVisible().catch(() => false);
const api = (path) => page.evaluate(async (p) => { const r = await fetch(p, { credentials: 'include' }); return { status: r.status, body: await r.json().catch(() => null) }; }, path);

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
async function shot(name, { targets = [], extra = {}, settle = 700 } = {}) {
  n += 1;
  const base = `${String(n).padStart(2, '0')}-${name}`;
  await page.waitForTimeout(settle);
  const probe = await page.evaluate(() => ({
    url: location.host + location.pathname + location.search,
    scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
    title: document.title,
  })).catch(() => ({}));
  probe.url = safeUrl(probe.url);
  await page.screenshot({ path: `${OUT}/${base}.png` }).catch(() => {});
  await Promise.race([page.screenshot({ path: `${OUT}/${base}-full.png`, fullPage: true }), new Promise((r) => setTimeout(r, 20000))]).catch(() => {});
  const spacing = await page.evaluate(PROBE).catch((e) => ({ error: String(e).slice(0, 120) }));
  const step = { n, name, file: `${base}.png`, ...probe, overflow: probe.scrollWidth > probe.innerWidth + 1, boxes: await boxes(targets), spacing, ...extra };
  report.steps.push(step);
  console.log('[shot]', JSON.stringify(step));
  return step;
}
async function step(name, fn, { soft = false } = {}) {
  try { await fn(); } catch (e) {
    report.errors.push({ step: name, error: safeUrl(String(e)).slice(0, 1600) });
    console.log('[error]', name, safeUrl(String(e)).slice(0, 400));
    await shot(`${name}-error`).catch(() => {});
    if (!soft) throw e;
  }
}
async function go(path, waitSel, name, opts = {}) {
  await page.goto(path.startsWith('http') ? path : BASE + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (waitSel) await page.waitForSelector(waitSel, { timeout: opts.timeout || 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  return shot(name, opts);
}

try {
  if (PHASE === 'all') {
    await step('welcome', async () => {
      await page.goto(WELCOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('#btnTestSignIn', { timeout: 30000 });
      await shot('welcome-test-link', { targets: ['#btnTestSignIn', '.wl-test'] });
      await Promise.all([page.waitForURL(/\/onboarding/, { timeout: 60000 }), page.click('#btnTestSignIn')]);
      // A redirect after the sign-in POST is not intercepted: load the page again so the
      // branch front end (OVERRIDE) is the one on screen.
      if (process.env.OVERRIDE === '1') await page.goto(BASE + '/onboarding', { waitUntil: 'domcontentloaded' });
    });
    // Since 2026-10-25 (test link session fix): an unfinished setup is where the photo is
    // taken, so the gate leads to /onboarding, not /my-photo; every test page carries the
    // «Test candidate · Back to my account» strip.
    if (NOTYPE) await step('photo-gate', async () => {
      await page.goto(BASE + '/mailbox', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForURL(/\/onboarding/, { timeout: 30000 });
      await page.waitForSelector('#svicQaBack', { timeout: 30000 });
      report.gatePage = new URL(page.url()).pathname;
      report.strip = await page.evaluate(() => { const el = document.getElementById('svicQaTest'); return el ? el.innerText.replace(/\s+/g, ' ').trim() : null; });
      await shot('gate-onboarding-with-strip', { targets: ['#svicQaBack'], extra: { gate: report.gatePage, strip: report.strip } });
      const probe = await api('/api/marketplace/book');
      report.gateApi = probe.status; report.gateApiPage = probe.body && probe.body.photoPage;
      if (probe.status !== 428 || report.gateApiPage !== '/onboarding') throw new Error('API before the photo answered ' + probe.status + ' ' + report.gateApiPage + ', expected 428 /onboarding');
    });
    await step('account', async () => {
      await page.waitForSelector('.ob-panel.on[data-astep="1"], .ob-panel.on[data-astep="2"]', { timeout: 30000 });
      await shot('setup-1-account', { targets: ['#aBtnNext1', '#aLiState', '#aBtnFace', '#aTest'] });
      if (await visible('#aBtnNext1')) await page.click('#aBtnNext1');
    });
    await step('details', async () => {
      await page.waitForSelector('.ob-panel.on[data-astep="2"]', { timeout: 15000 });
      if (NOTYPE) {
        await page.waitForSelector('#aPhotoImg:not([hidden])', { timeout: 15000 });
        const vals = await page.evaluate(() => ({ phone: document.getElementById('aPh').value, city: document.getElementById('aCity').value,
          state: document.getElementById('aSt').value || document.getElementById('aStText').value, country: document.getElementById('aCtry').value,
          photo: !document.getElementById('aPhotoRow').hidden && !!document.getElementById('aPhotoImg').src, tag: document.getElementById('aPhotoTag').textContent.trim(),
          continueEnabled: !document.getElementById('aBtnDetails').disabled }));
        report.prefill = vals;
        await shot('setup-2-details-prefilled', { targets: ['#aPh', '#aCity', '#aPhotoRow', '#aBtnDetails'], extra: { prefill: vals } });
        if (!vals.phone || !vals.city || !vals.state || !vals.photo || !vals.continueEnabled) throw new Error('Details not prefilled: ' + JSON.stringify(vals));
        await page.click('#aBtnDetails');
        return;
      }
      await shot('setup-2-details-empty', { targets: ['#aCtry', '#aPh', '#aSt', '#aCity', '#aBtnDetails'] });
      await page.selectOption('#aCtry', 'US');
      await page.selectOption('#aSt', 'New York');
      await page.fill('#aPh', '(212) 555-0142');
      await page.fill('#aCity', 'New York');
      await shot('setup-2-details-filled', { targets: ['#aPh', '#aCity', '#aBtnDetails'] });
      await page.click('#aBtnDetails');
    });
    await step('documents', async () => {
      await page.waitForSelector('.ob-panel.on[data-astep="3"]', { timeout: 20000 });
      await shot('setup-3-documents', { targets: ['#aDocs', '#aBtnSign', '#aDoc1', '#aDoc2'] });
      await Promise.all([page.waitForURL(/\/sign\//, { timeout: 90000 }), page.click('#aBtnSign')]);
      await page.waitForSelector('#step-consent:not([hidden]), #step-sign:not([hidden]), #gate:not([hidden])', { timeout: 30000 });
      if (await visible('#gate')) { await shot('sign-gate'); throw new Error('signing page shows a gate'); }
      if (await visible('#step-consent')) {
        await shot('sign-consent', { targets: ['#consentChk', '#consentBtn'] });
        await page.check('#consentChk');
        await page.click('#consentBtn');
      }
      await page.waitForSelector('#actionbar:not([hidden]) #nextBtn', { timeout: 30000 });
      await page.waitForSelector('.fw', { timeout: 30000 });
      await shot('sign-document', { targets: ['#nextBtn', '.fw'] });
      let adopted = false;
      for (let i = 0; i < 16; i++) {
        if (await visible('.modal-hd')) {
          await page.click('#t-type');
          if (NOTYPE) {
            const typed = await page.inputValue('#typedName');
            report.typedName = typed ? 'prefilled' : 'empty';
            if (!typed) throw new Error('typed signature not prefilled');
          } else await page.fill('#typedName', SIGN_NAME);
          if (!adopted) await shot('sign-adopt', { targets: ['#typedName', '.modal-ft .btn-primary'] });
          adopted = true;
          await page.click('text=Adopt and sign');
          await page.waitForTimeout(600);
          continue;
        }
        const label = (await page.textContent('#nextBtn')) || '';
        if (/Finish/.test(label)) break;
        await page.click('#nextBtn');
        await page.waitForTimeout(600);
      }
      await shot('sign-ready', { targets: ['#nextBtn'] });
      await Promise.all([page.waitForURL(/\/onboarding/, { timeout: 60000 }), page.click('#nextBtn')]);
      await page.waitForSelector('.ob-panel.on[data-astep="3"], .ob-panel.on[data-astep="4"]', { timeout: 30000 });
      await page.waitForTimeout(1500);
      await shot('setup-3-signed', { targets: ['#aDocs', '#aSignNote', '#aBtnDocsNext'], extra: { documents: (await api('/api/onboarding')).body?.associate?.documents?.state } });
      if (await visible('#aBtnDocsNext')) await page.click('#aBtnDocsNext');
    });
    await step('work-email', async () => {
      await page.waitForSelector('.ob-panel.on[data-astep="4"]', { timeout: 20000 });
      await page.waitForFunction(() => /Created/.test((document.getElementById('aAddrTag') || {}).textContent || ''), null, { timeout: 90000 }).catch(() => {});
      await shot('setup-4-work-email', { targets: ['#aAddr', '#aBtnMailNext'] });
      await Promise.all([page.waitForURL(/\/mailbox/, { timeout: 60000 }), page.click('#aBtnMailNext')]);
    });
    await step('welcome-window', async () => {
      await page.waitForSelector('#pathWelcomeH', { timeout: 30000 });
      await shot('mail-welcome-window', { targets: ['#pathWelcomeH', '.path-list li:nth-child(2)', '#pathWelcomePath', '#pathWelcomeGo'], settle: 1500 });
      await Promise.all([page.waitForURL(/\/my-path/, { timeout: 30000 }), page.click('#pathWelcomePath')]);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await shot('my-path', { targets: ['#yourPath', '#pathNext'], settle: 1500 });
    }, { soft: true });
  }

  if (PHASE === 'platform') {
    await step('sign-in-again', async () => {
      await page.goto(WELCOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('#btnTestSignIn', { timeout: 30000 });
      await Promise.all([page.waitForURL(/\/(onboarding|mailbox)/, { timeout: 60000 }), page.click('#btnTestSignIn')]);
    });
  }
  await step('mail', async () => {
    await go('/mailbox', '.mrow, .mb-empty, .empty', 'mail-inbox', { targets: ['#yourPath', '#pathNext', '.mrow'], timeout: 45000, settle: 1500 });
    const row = page.locator('.mrow').first();
    if (await row.isVisible().catch(() => false)) {
      await row.click();
      await page.waitForTimeout(2500);
      await shot('mail-letter', { targets: ['.msg-subj', '.msg-body'] });
    }
  }, { soft: true });
  await step('signature', async () => { await go('/signature-setup', 'body', 'signature', { settle: 2500 }); }, { soft: true });
  let meetUrl = null;
  await step('scheduling', async () => {
    await go('/scheduling', '#setupLink, .sch-console-grid, main', 'scheduling', { targets: ['#setupLink', '.sch-console-grid'], timeout: 45000, settle: 2500 });
    meetUrl = await page.evaluate(() => { const a = document.getElementById('setupLink'); return a && a.href ? a.href : null; }).catch(() => null);
  }, { soft: true });
  if (meetUrl) await step('meet-page', async () => { await go(meetUrl, 'body', 'meet-page', { targets: ['.sch-day.available'], settle: 3500 }); }, { soft: true });
  await step('exam-prep', async () => {
    await go('/training/exam-prep', '#xpExam, main', 'exam-prep', { targets: ['#xpExam', '#xpStudy'], settle: 2000 });
    if (await visible('#xpExam [data-exam="S7"]')) { await page.click('#xpExam [data-exam="S7"]'); await shot('exam-prep-s7', { settle: 1500 }); }
    const read = page.locator('[data-read]').first();
    if (await read.isVisible().catch(() => false)) { await read.click(); await shot('exam-prep-lesson', { settle: 2000 }); }
  }, { soft: true });
  await step('desk-marketplace', async () => {
    await go('/candidate-preview', 'body', 'desk-marketplace', { targets: ['.ds-sealed', '.market-table'], settle: 4000 });
    const sealed = page.locator('.ds-sealed').first();
    if (await sealed.isVisible().catch(() => false) && ENGINE === 'chromium') { await sealed.hover(); await shot('desk-marketplace-sealed-hover', { settle: 800 }); }
  }, { soft: true });
  await step('desk-matches', async () => {
    await go('/desk/matches', 'body', 'desk-matches', { targets: ['#convo .td-pair-row .nm', '#coList .co-item', '#tdTake'], settle: 4000 });
    // On a phone the start screen is the list (2026-10-25: the rail is a separate view, not beside it).
    const row = page.locator('#convo .td-pair-row .nm >> visible=true').first();
    const item = (await row.isVisible().catch(() => false)) ? row : page.locator('#coList .co-item').first();
    if (await item.isVisible().catch(() => false)) { await item.click(); await shot('desk-matches-open', { targets: ['#tdTake', '.ds-sealed'], settle: 2500 }); }
    if (ENGINE === 'chromium' && await visible('#tdTake')) { await page.hover('#tdTake'); await shot('desk-matches-take-hover', { targets: ['#tdTake'], settle: 800 }); }
  }, { soft: true });
  await step('desk-order-book', async () => {
    await go('/desk/order-book', 'body', 'desk-order-book', { targets: ['#coList .co-item'], settle: 4000 });
    const item = page.locator('#coList .co-item').first();
    if (await item.isVisible().catch(() => false)) { await item.click(); await shot('desk-order-book-open', { targets: ['.ds-sealed'], settle: 2500 }); }
  }, { soft: true });
  await step('desk-pipeline', async () => { await go('/desk/pipeline', 'body', 'desk-pipeline', { settle: 3500 }); }, { soft: true });
  await step('desk-clients', async () => { await go('/desk/clients', 'body', 'desk-clients', { settle: 3500 }); }, { soft: true });
  await step('menu', async () => {
    await go('/mailbox', 'body', 'menu-closed', { settle: 1500 });
    const burger = page.locator('[aria-label*="menu" i], .topbar .menu-btn, #menuBtn, .tb-menu').first();
    if (await burger.isVisible().catch(() => false)) { await burger.click(); await shot('menu-open', { settle: 1200 }); }
  }, { soft: true });
  report.path = (await api('/api/my-path').catch(() => ({}))).body || null;
  if (NOTYPE) await step('back-to-my-account', async () => {
    await go('/my-path', '#svicQaBack', 'strip-before-back', { targets: ['#svicQaBack'] });
    await Promise.all([page.waitForURL(/\/login/, { timeout: 30000 }), page.click('#svicQaBack')]);
    report.afterBack = { url: new URL(page.url()).pathname, me: (await api('/api/auth/me')).status, strip: await visible('#svicQaTest') };
    await shot('after-back', { extra: report.afterBack });
    if (report.afterBack.me !== 401 || report.afterBack.strip) throw new Error('back did not close the test session: ' + JSON.stringify(report.afterBack));
  }, { soft: true });
} catch (e) {
  report.fatal = safeUrl(String(e)).slice(0, 400);
} finally {
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  await browser.close();
}
console.log('[done]', report.steps.length, 'shots,', report.errors.length, 'errors', report.fatal ? 'FATAL ' + report.fatal : '');
