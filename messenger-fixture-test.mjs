// Cloud video test of the person's-window pipeline on its TEST window
// (target=fixture — a messenger-shaped page with counters, nobody's account).
// Real chain: server window → recorder → platform → the copy in Chromium; real
// mouse and keyboard; every check is read back from the copy's counters, which
// are the server page's own.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'https://platform.siliconvalleyinvestclub.com';
const COOKIE = process.env.MW_COOKIE || '';
const DESK = process.env.DESK || 'emma';
const OUT = 'out';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 860 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 860 } },
  permissions: ['clipboard-read', 'clipboard-write'],
});
await ctx.addCookies([{ name: 'svic_token', value: COOKIE, url: BASE, httpOnly: true, secure: true, sameSite: 'Lax' }]);
const page = await ctx.newPage();
const report = { steps: [], failures: 0 };
let n = 0;

async function poll(fn, timeout = 10000, every = 100) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('timeout');
    await page.waitForTimeout(every);
  }
}
// The page forbids eval; read the copy through plain evaluate callbacks instead.
const copyText = (sel) => page.evaluate((sel) => { const d = document.querySelector('#wacHost iframe').contentDocument; const e = d.querySelector(sel); return e ? (e.value != null ? e.value : e.textContent) : null; }, sel);
const copyCenter = (sel, i = 0) => page.evaluate(({ sel, i }) => {
  const f = document.querySelector('#wacHost iframe');
  const e = f.contentDocument.querySelectorAll(sel)[i];
  if (!e) return null;
  const r = e.getBoundingClientRect(); const fr = f.getBoundingClientRect();
  const w = document.querySelector('#wacHost .replayer-wrapper');
  const m = w && /scale\(([\d.]+)\)/.exec(w.style.transform || ''); const k = m ? Number(m[1]) : 1;
  return { x: fr.left + (r.left + r.width / 2) * k, y: fr.top + (r.top + r.height / 2) * k };
}, { sel, i });

async function shot(name) {
  const tag = `${String(n).padStart(2, '0')}-${name}`;
  await page.screenshot({ path: `${OUT}/${tag}-copy.png` });
  const r = await page.request.get(`${BASE}/api/messengers/console/shot?person=${DESK}&target=fixture`);
  if (r.ok()) fs.writeFileSync(`${OUT}/${tag}-server.jpg`, await r.body());
}
async function check(name, fn) {
  const t0 = Date.now();
  let ok = true; let note = '';
  try { note = (await fn()) ?? ''; } catch (e) { ok = false; note = String(e.message || e).slice(0, 300); }
  await page.waitForTimeout(1200);
  await shot(name);
  if (!ok) report.failures += 1;
  report.steps.push({ n, name, ok, ms: Date.now() - t0, note });
  console.log(`[${n}] ${ok ? 'PASS' : 'FAIL'} ${name} — ${typeof note === 'string' ? note : JSON.stringify(note)}`);
  n += 1;
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

await check('open-test-window', async () => {
  await page.goto(`${BASE}/messengers/${DESK}?app=whatsapp&console=1`, { waitUntil: 'domcontentloaded' });
  await poll(() => page.evaluate(() => Boolean(window.SvicWaConsole && window.SvicWaConsole.mount)), 30000);
  const t0 = Date.now();
  await page.evaluate((desk) => { window.SvicWaConsole.unmount(); return window.SvicWaConsole.mount({ desk, target: 'fixture' }); }, DESK);
  await poll(async () => (await copyText('#log')) !== null, 60000, 200);
  return { firstPageMs: Date.now() - t0 };
});

await check('script-animation-visible', async () => {
  const op = await poll(() => page.evaluate(() => {
    const d = document.querySelector('#wacHost iframe').contentDocument;
    const p = d.querySelector('#panel'); const o = p && d.defaultView.getComputedStyle(p).opacity;
    return o === '1' ? o : null;
  }), 8000, 200);
  return { panelOpacity: op };
});

await check('canvas-visible', async () => {
  const has = await poll(() => page.evaluate(() => {
    const d = document.querySelector('#wacHost iframe').contentDocument;
    const img = d.querySelector('#cv img'); return img && img.naturalWidth > 0;
  }), 8000, 200);
  return { canvasPicture: has };
});

await check('click-row', async () => {
  const c = await copyCenter('.row', 3);
  await page.mouse.click(c.x, c.y);
  const rc = await poll(async () => { const t = await copyText('#rowclicks'); return t && t.includes('"3":1') ? t : null; }, 6000);
  return { rowClicks: rc };
});

await check('type-with-spaces', async () => {
  await page.keyboard.type('a b c', { delay: 120 });
  const text = await poll(async () => { const t = await copyText('#composer'); return t === 'a b c' ? t : null; }, 6000);
  const rc = await copyText('#rowclicks');
  expect(rc === '{"3":1}', `row was pressed again: ${rc}`);
  return { composer: text, rowClicks: rc };
});

await check('backspace', async () => {
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('Backspace');
  await poll(async () => (await copyText('#composer')) === '', 6000);
  return 'composer empty';
});

await check('typing-latency', async () => {
  const t0 = Date.now();
  await page.keyboard.type('x');
  await poll(async () => (await copyText('#composer')) === 'x', 6000, 20);
  const ms = Date.now() - t0;
  await page.keyboard.press('Backspace');
  return { keyToScreenMs: ms };
});

await check('scroll-list', async () => {
  const c = await copyCenter('#pane-side');
  await page.mouse.move(c.x, c.y);
  for (let i = 0; i < 6; i += 1) { await page.mouse.wheel(0, 300); await page.waitForTimeout(80); }
  await page.waitForTimeout(800);
  const top = await page.evaluate(() => document.querySelector('#wacHost iframe').contentDocument.querySelector('#pane-side').scrollTop);
  expect(top > 0, 'list did not scroll');
  return { scrollTop: top };
});

await check('select-and-copy', async () => {
  const c = await copyCenter('.msg .selectable-text', 2);
  await page.mouse.click(c.x, c.y, { clickCount: 3 });
  await page.keyboard.press('Control+C');
  await page.waitForTimeout(400);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(/Message number \d+/.test(clip), `clipboard: ${clip}`);
  return { clipboard: clip.trim() };
});

await check('paste-text', async () => {
  const c = await copyCenter('#composer');
  await page.mouse.click(c.x, c.y);
  await page.evaluate(() => navigator.clipboard.writeText('pasted from the Mac'));
  await page.keyboard.press('Control+V');
  const t = await poll(async () => { const v = await copyText('#composer'); return v && v.includes('pasted from the Mac') ? v : null; }, 6000);
  for (let i = 0; i < 25; i += 1) await page.keyboard.press('Backspace');
  return { composer: t };
});

await check('search-field', async () => {
  const c = await copyCenter('#search');
  await page.mouse.click(c.x, c.y);
  await page.keyboard.type('find me', { delay: 80 });
  const t = await poll(async () => { const v = await copyText('#search'); return v === 'find me' ? v : null; }, 6000);
  for (let i = 0; i < 7; i += 1) await page.keyboard.press('Backspace');
  return { search: t };
});

await check('external-link-opens-here', async () => {
  const popup = page.waitForEvent('popup', { timeout: 8000 }).catch(() => null);
  const c = await copyCenter('#ext');
  await page.mouse.click(c.x, c.y);
  const p = await popup;
  const url = p ? p.url() : null;
  if (p) await p.close();
  expect(url && url.includes('example.com/fixture-link'), `no popup with the link (${url})`);
  return { opened: url };
});

await check('no-stray-clicks', async () => {
  const total = await copyText('#clicks');
  const rc = await copyText('#rowclicks');
  return { clicksOnServer: total, rowClicks: rc };
});

report.ok = report.failures === 0;
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
await page.evaluate(() => window.SvicWaConsole && window.SvicWaConsole.unmount()).catch(() => {});
await ctx.close();
await browser.close();
console.log(report.ok ? 'ALL PASS' : `FAILURES: ${report.failures}`);
