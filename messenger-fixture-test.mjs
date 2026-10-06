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
const copyText = (sel) => page.evaluate((sel) => { const d = document.querySelector('#wacHost iframe').contentDocument; const e = d.querySelector(sel); return e ? String(e.value != null ? e.value : e.textContent).replace(/\u00a0/g, ' ') : null; }, sel);
const copyCenter = (sel, i = 0, fx = 0.5) => page.evaluate(({ sel, i, fx }) => {
  const f = document.querySelector('#wacHost iframe');
  const e = f.contentDocument.querySelectorAll(sel)[i];
  if (!e) return null;
  const r = e.getBoundingClientRect(); const fr = f.getBoundingClientRect();
  const w = document.querySelector('#wacHost .replayer-wrapper');
  const m = w && /scale\(([\d.]+)\)/.exec(w.style.transform || ''); const k = m ? Number(m[1]) : 1;
  return { x: fr.left + (r.left + r.width * fx) * k, y: fr.top + (r.top + r.height / 2) * k };
}, { sel, i, fx });

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


// ── Typing: keys go to the window, the window types (2026-10-06) ──────────
const waitCopy = (sel, want, t = 6000) => poll(async () => { const v = await copyText(sel); return (typeof want === 'function' ? want(v) : v === want) ? (v ?? '') + ' ' : null; }, t, 40);
const caret = () => page.evaluate(() => {
  const d = document.querySelector('#wacHost iframe').contentDocument;
  const sel = d.getSelection();
  const n = sel && sel.anchorNode;
  const host = n && (n.nodeType === 1 ? n : n.parentElement);
  return { focused: d.hasFocus(), inComposer: Boolean(host && host.closest && host.closest('#composer')), collapsed: sel ? sel.isCollapsed : null };
});

await check('click-puts-caret-in-field', async () => {
  const c = await copyCenter('#composer', 0, 0.15);
  await page.mouse.click(c.x, c.y);
  const st = await poll(async () => { const s = await caret(); return s.focused && s.inComposer ? s : null; }, 4000);
  // the test window lives on between runs: start from an empty field
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await waitCopy('#composer', '', 6000);
  return st;
});

await check('type-text-reaches-window', async () => {
  const t0 = Date.now();
  await page.keyboard.type('hello world', { delay: 40 });
  await waitCopy('#composer', 'hello world', 8000);
  const firstEcho = Date.now() - t0;
  // echo of one more letter, measured alone
  const t1 = Date.now();
  await page.keyboard.type('!');
  await waitCopy('#composer', 'hello world!', 6000);
  const oneKey = Date.now() - t1;
  await page.keyboard.press('Backspace');
  await waitCopy('#composer', 'hello world', 6000);
  return { allTypedAfterMs: firstEcho, oneKeyEchoMs: oneKey };
});

await check('caret-moves-inside-text', async () => {
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('big ');
  await waitCopy('#composer', 'hello big world');
  const c = await caret();
  expect(c.inComposer, 'caret left the field');
  return 'hello big world';
});

await check('corrections-backspace', async () => {
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('Backspace');
  await waitCopy('#composer', 'hello world');
  return 'hello world';
});

await check('select-all-replace', async () => {
  await page.keyboard.press('Control+A');
  await page.keyboard.type('fresh text');
  await waitCopy('#composer', 'fresh text');
  return 'fresh text';
});

await check('russian-layout', async () => {
  await page.keyboard.press('End');
  // keyboard.type inserts letters outside the US layout without a key press;
  // a Mac in the Russian layout sends real key presses, so press them.
  // A Mac in the Russian layout: the physical key (KeyG…) carrying a Russian letter.
  const cdp = await page.context().newCDPSession(page);
  const RU = { ' ': ['Space', 32], 'п': ['KeyG', 71], 'р': ['KeyH', 72], 'и': ['KeyB', 66], 'в': ['KeyD', 68], 'е': ['KeyT', 84], 'т': ['KeyN', 78] };
  for (const ch of ' привет') {
    const [code, vk] = RU[ch];
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code, text: ch, windowsVirtualKeyCode: vk });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code, windowsVirtualKeyCode: vk });
    await page.waitForTimeout(40);
  }
  await waitCopy('#composer', 'fresh text привет');
  for (let i = 0; i < 7; i += 1) await page.keyboard.press('Backspace');
  await waitCopy('#composer', 'fresh text');
  return 'привет typed and removed';
});

let sentBefore = 0;
await check('shift-enter-new-line', async () => {
  sentBefore = Number(await copyText('#sent')) || 0;   // the test window keeps its count between runs
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('line two');
  await waitCopy('#composer', (v) => v && v.includes('fresh text') && v.includes('line two'));
  const sent = Number(await copyText('#sent')) || 0;
  expect(sent === sentBefore, 'Shift+Enter sent the message');
  return 'two lines, not sent';
});

await check('enter-sends', async () => {
  await page.keyboard.press('Enter');
  await waitCopy('#sent', String(sentBefore + 1), 6000);
  const last = await copyText('#lastsent');
  await waitCopy('#composer', '', 6000);
  expect(last.includes('fresh text') && last.includes('line two'), `sent: ${last}`);
  return { sent: last };
});

await check('copy-selected-text', async () => {
  await page.keyboard.type('copy me');
  await waitCopy('#composer', 'copy me');
  await page.keyboard.press('Control+A');
  await page.waitForTimeout(600);
  await page.keyboard.press('Control+C');
  await page.waitForTimeout(400);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip === 'copy me', `clipboard: ${clip}`);
  return { clipboard: clip };
});

await check('paste-into-window', async () => {
  await page.evaluate(() => navigator.clipboard.writeText(' + pasted'));
  await page.keyboard.press('End');
  await page.keyboard.press('Control+V');
  await waitCopy('#composer', 'copy me + pasted');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await waitCopy('#composer', '');
  return 'copy me + pasted';
});

await check('plain-input-field', async () => {
  const c = await copyCenter('#inp');
  await page.mouse.click(c.x, c.y);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await waitCopy('#inp', '');
  await page.keyboard.type('abc 123', { delay: 40 });
  await waitCopy('#inp', 'abc 123');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await waitCopy('#inp', '');
  return 'abc 123';
});

await check('rows-not-pressed-by-typing', async () => {
  const rc = await copyText('#rowclicks');
  expect(rc === '{"3":1}', `row pressed again: ${rc}`);
  return { rowClicks: rc };
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
  await page.waitForTimeout(700);
  const selected = await page.evaluate(() => String(document.querySelector('#wacHost iframe').contentDocument.defaultView.getSelection()));
  expect(/Message number/.test(selected), `selection in the copy lost: "${selected.slice(0, 60)}"`);
  await page.keyboard.press('Control+C');
  await page.waitForTimeout(400);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(/Message number \d+/.test(clip), `clipboard: ${clip}`);
  return { clipboard: clip.trim() };
});

await check('search-field', async () => {
  const top = await copyCenter('#pane-side');
  await page.mouse.move(top.x, 40);
  for (let i = 0; i < 6; i += 1) { await page.mouse.wheel(0, -600); await page.waitForTimeout(80); }
  await page.waitForTimeout(800);
  const c = await copyCenter('#search');
  await page.mouse.click(c.x, c.y);
  await page.keyboard.type('find me', { delay: 60 });
  const t = await poll(async () => { const v = await copyText('#search'); return v === 'find me' ? v : null; }, 6000);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape');
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
