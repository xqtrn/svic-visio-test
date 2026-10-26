// photo-screens.mjs — the new-member photo step (platform, 2026-10-25) in a real
// browser before it ships: /my-photo, the associate Details step with the photo row
// (a test candidate's prefilled form) and the partner portal's photo step. The
// branch's front-end files come from overrides/photo; the platform's own shared
// files (app.css, fonts, loader, ui.js, logo) are the live ones; every /api answer
// is a fixed sample — nothing reaches the platform's data.
// Env: ENGINE (webkit = iPhone 393 | chromium = desktop 1440).
import { webkit, chromium } from 'playwright';
import fs from 'fs';

const ENGINE = process.env.ENGINE === 'webkit' ? 'webkit' : 'chromium';
const OUT = 'out';
const DIR = 'overrides/photo';
fs.mkdirSync(OUT, { recursive: true });
const PROBE = fs.readFileSync('overrides/ds-spacing-probe.browser.js', 'utf8');
const profile = ENGINE === 'webkit'
  ? { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }
  : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25 };
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const ctx = await browser.newContext({ ...profile, locale: 'en-US' });
const report = { engine: ENGINE, steps: [], errors: [], puts: [], strip: STRIP };
if (STRIP) await ctx.addCookies([{ name: 'svic_qa_test', value: 'r', domain: 'platform.siliconvalleyinvestclub.com', path: '/', secure: true, sameSite: 'Lax' }]);
const PLATFORM = 'platform.siliconvalleyinvestclub.com';
const PORTAL = 'portal.siliconvalleyinvestclub.com';
// STRIP=1 (2026-10-25, test candidate session): the branch loader.js draws the «Test candidate ·
// Back to my account» strip from the svic_qa_test cookie; the run sets that cookie and checks it.
const STRIP = process.env.STRIP === '1';
const OWN = new Set(['my-photo.html', 'my-photo.js', 'member-photo.js', 'onboarding.css', 'onboarding.html', 'onboarding.js', 'onboarding-associate.js', 'auth-guard.js', ...(STRIP ? ['loader.js'] : [])]);
const type = (f) => f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'application/javascript' : f.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8';
const file = (f) => ({ status: 200, contentType: type(f), body: fs.readFileSync(`${DIR}/${f}`) });
const json = (o, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(o) });
const COUNTRIES = [{ code: 'US', name: 'United States', dial: '1', regionLabel: 'State', regions: ['California', 'New York', 'Texas'] }, { code: 'CA', name: 'Canada', dial: '1', regionLabel: 'Province', regions: ['Ontario'] }];
let photoSaved = null;

async function testPhoto() {
  // the platform's TEST stand-in, drawn the same way (navy, silhouette, TEST label)
  const p = await ctx.newPage();
  const url = await p.evaluate(() => {
    const c = document.createElement('canvas'); c.width = c.height = 480; const x = c.getContext('2d');
    x.fillStyle = '#0a1733'; x.fillRect(0, 0, 480, 480); x.fillStyle = '#586273';
    x.beginPath(); x.arc(240, 190, 86, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.moveTo(70, 480); x.bezierCurveTo(88, 376, 158, 320, 240, 320); x.bezierCurveTo(322, 320, 392, 376, 410, 480); x.fill();
    x.fillStyle = '#f5f7fa'; x.fillRect(150, 392, 180, 56); x.fillStyle = '#0a1733'; x.font = 'bold 34px Helvetica, Arial'; x.textAlign = 'center'; x.fillText('TEST', 240, 432);
    return c.toDataURL('image/png');
  });
  await p.close();
  return url;
}
const TEST_PHOTO = await testPhoto();

await ctx.route((u) => u.hostname === PLATFORM || u.hostname === PORTAL, async (route, req) => {
  const u = new URL(req.url());
  const p = u.pathname;
  if (u.hostname === PORTAL) {
    if (p === '/api/me') return route.fulfill(json({ name: 'Pat Partner', firm: 'Example Capital', preview: false, level: 'premium', levelLabel: 'Premium', role: 'fund', roleLabel: 'Fund', caps: {}, sections: [], levels: [], unread: 0, photoRequired: true, minPhotoSide: 200 }));
    if (p === '/api/photo' && req.method() === 'PUT') { report.puts.push('portal'); return route.fulfill(json({ ok: true, photoUrl: '/api/public/staff-photo/x.jpg' })); }
    if (p.startsWith('/api/')) return route.fulfill(json({ error: 'Add your photo to continue.', code: 'photo_required' }, 428));
    const asset = p.match(/^\/portal\/assets\/(.+)$/);
    if (asset) {
      const f = asset[1];
      if (f === 'portal.js' || f === 'portal.css' || f === 'member-photo.js') return route.fulfill(file(f));
      const live = await route.fetch({ url: `https://${PLATFORM}/portal/assets/${f}` });
      return route.fulfill({ response: live });
    }
    return route.fulfill(file('portal-index.html'));
  }
  // platform host
  const own = p.slice(1);
  if (OWN.has(own)) return route.fulfill(file(own));
  if (p === '/my-photo') return route.fulfill(file('my-photo.html'));
  if (p === '/onboarding') return route.fulfill(file('onboarding.html'));
  if (p === '/api/nav') return route.fulfill(json({ menu: { pinned: [], groups: [] }, landing: '/' }));
  if (p === '/api/my-path') return route.fulfill(json({ path: null }));
  if (p === '/api/auth/methods') return route.fulfill(json({ identities: [], passkeys: [] }));
  if (p === '/api/member-photo' && req.method() === 'GET') return route.fulfill(json({ name: 'Riley Morgan', required: !photoSaved, mandatory: true, photoUrl: photoSaved, minSide: 200, preview: false }));
  if (p === '/api/member-photo' && req.method() === 'PUT') {
    const body = JSON.parse(req.postData() || '{}');
    report.puts.push('member-photo:' + String(body.dataUrl || '').slice(0, 23));
    photoSaved = '/__face.png';
    return route.fulfill(json({ ok: true, photoUrl: photoSaved }));
  }
  if (p === '/__face.png') return route.fulfill(file('face.png'));
  if (p === '/api/onboarding' && req.method() === 'GET') return route.fulfill(json({
    variant: 'associate', steps: ['Account', 'Details', 'Documents', 'Work email'], user: { name: 'Jordan QA', email: null },
    profile: null, photoRequired: true, preview: false, states: COUNTRIES[0].regions, countries: COUNTRIES,
    prefill: { phone: '(555) 555-0142', phoneCountry: 'US', country: 'US', state: 'California', city: 'Test City', photo: TEST_PHOTO },
    associate: { test: { expiresAt: '2026-11-01T19:31:48Z' }, firstName: 'Jordan', lastName: 'QA', title: 'Private Markets Associate', workEmail: null, plannedEmail: 'jordan.qa@siliconvalleyinvestclub.com',
      mailboxReady: false, signatureReady: false, documents: { state: 'none', signed: false, items: [{ key: 'a', title: 'Associate Agreement', subtitle: 'Independent contractor terms' }, { key: 'c', title: 'Confidentiality Agreement', subtitle: 'What stays inside the firm' }], countersigner: 'Siarhei Hlebko', firm: 'SVIC LTD' }, completedAt: null },
  }));
  if (p === '/api/onboarding/photo' && req.method() === 'PUT') { report.puts.push('onboarding-photo'); return route.fulfill(json({ ok: true, photoUrl: '/__face.png' })); }
  if (p === '/api/onboarding/details' && req.method() === 'PUT') { report.puts.push('onboarding-details'); return route.fulfill(json({ ok: true, phone: '(555) 555-0142', state: 'California', city: 'Test City', country: 'US' })); }
  if (p.startsWith('/api/')) return route.fulfill(json({ error: 'sample stand' }, 404));
  return route.fallback();
});

const page = await ctx.newPage();
page.on('pageerror', (e) => report.errors.push({ step: 'pageerror', url: page.url(), error: String(e).slice(0, 300) }));
page.on('console', (m) => { if (m.type() === 'error' && !/404|sample stand/.test(m.text())) report.errors.push({ step: 'console', url: page.url(), error: m.text().slice(0, 300) }); });
page.on('dialog', (d) => { report.errors.push({ step: 'native-dialog', error: d.message() }); d.dismiss().catch(() => {}); });
let n = 0;
async function shot(name, extra = {}) {
  n += 1;
  await page.waitForTimeout(900);
  const base = `${String(n).padStart(2, '0')}-${name}`;
  await page.screenshot({ path: `${OUT}/${base}.png` });
  await page.screenshot({ path: `${OUT}/${base}-full.png`, fullPage: true }).catch(() => {});
  const probe = await page.evaluate(() => ({ url: location.host + location.pathname, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })).catch(() => ({}));
  const spacing = await page.evaluate(PROBE).catch((e) => ({ error: String(e).slice(0, 120) }));
  const strip = STRIP && page.url().includes('platform.') ? await page.evaluate(() => {
    const el = document.getElementById('svicQaTest'); if (!el) return null;
    const r = el.getBoundingClientRect(); const a = document.getElementById('svicQaBack');
    return { text: el.innerText.replace(/\s+/g, ' ').trim(), top: Math.round(r.top), height: Math.round(r.height), width: Math.round(r.width), back: a && a.getAttribute('href') };
  }).catch(() => null) : undefined;
  if (STRIP && page.url().includes('platform.') && !strip) report.errors.push({ step: 'strip-missing', url: page.url() });
  const step = { n, name, file: `${base}.png`, ...probe, overflow: probe.scrollWidth > probe.innerWidth + 1, spacing, strip, ...extra };
  report.steps.push(step);
  console.log('[shot]', JSON.stringify(step));
}
const text = (sel) => page.locator(sel).first().textContent().catch(() => null);
const shown = (sel) => page.locator(sel).first().isVisible().catch(() => false);

try {
  // 1. /my-photo — empty, a too-small photo, then a good one
  await page.goto(`https://${PLATFORM}/my-photo?next=%2Fmailbox`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#mpPick');
  await shot('my-photo-empty', { buttons: { pick: await text('#mpPick'), camera: await shown('#mpCamera') ? await text('#mpCamera') : null, next: await page.locator('#mpNext').isDisabled() ? 'disabled' : 'enabled' } });
  await page.setInputFiles('#mpFile', `${DIR}/small.png`);
  await page.waitForSelector('#mpErr:not([hidden])', { timeout: 10000 });
  await shot('my-photo-too-small', { error: await text('#mpErr') });
  await page.setInputFiles(await shown('#mpCamera') ? '#mpCamFile' : '#mpFile', `${DIR}/face.png`);
  await page.waitForSelector('#mpImg:not([hidden])', { timeout: 10000 });
  await shot('my-photo-added', { buttons: { pick: await text('#mpPick'), next: await page.locator('#mpNext').isDisabled() ? 'disabled' : 'enabled' } });

  // 2. associate Details for a test candidate: every field and the photo prefilled
  await page.goto(`https://${PLATFORM}/onboarding`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ob-panel.on[data-astep="1"]');
  await page.click('#aBtnNext1');
  await page.waitForSelector('.ob-panel.on[data-astep="2"]');
  await shot('associate-details-prefilled', { continueEnabled: !(await page.locator('#aBtnDetails').isDisabled()), tag: await text('#aPhotoTag'), phone: await page.inputValue('#aPh'), city: await page.inputValue('#aCity') });
  await page.click('#aBtnDetails');
  await page.waitForSelector('.ob-panel.on[data-astep="3"]', { timeout: 10000 });
  await shot('associate-after-continue');

  // 2b. STRIP: «Back to my account» goes to the server's restore address (answered here: the
  // stand has no session).
  if (STRIP) {
    await page.route(/\/auth\/qa-test-back$/, (route) => route.fulfill({ status: 302, headers: { location: '/login?back=ok' } }));
    await page.goto(`https://${PLATFORM}/onboarding`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#svicQaBack');
    await shot('strip-on-onboarding');
    await Promise.all([page.waitForURL(/\/login\?back=ok/, { timeout: 15000 }), page.click('#svicQaBack')]);
    report.backClick = new URL(page.url()).pathname + new URL(page.url()).search;
  }

  // 3. partner portal: the photo step before any section
  await page.goto(`https://${PORTAL}/market`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#phPick');
  await shot('portal-photo-empty', { buttons: { pick: await text('#phPick'), camera: await shown('#phCam') ? await text('#phCam') : null } });
  await page.setInputFiles(await shown('#phCam') ? '#phCamFile' : '#phFile', `${DIR}/face.png`);
  await page.waitForSelector('#phImg:not([hidden])', { timeout: 10000 });
  await shot('portal-photo-added', { next: await page.locator('#phNext').isDisabled() ? 'disabled' : 'enabled' });
} catch (e) {
  report.fatal = String(e).slice(0, 400);
  await page.screenshot({ path: `${OUT}/zz-fatal.png` }).catch(() => {});
} finally {
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  await browser.close();
}
console.log('[done]', report.steps.length, 'shots,', report.errors.length, 'errors', report.fatal ? 'FATAL ' + report.fatal : '');
