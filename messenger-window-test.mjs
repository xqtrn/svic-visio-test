// Cloud video test of the person's WhatsApp / Telegram window as the Mac
// programs show it (platform page /messengers/<person>?app=<channel>&console=1).
// Chromium (the programs are Chromium), real mouse and keyboard, a video of the
// whole run, and at every step the copy beside a snapshot of the window on the
// server — any divergence is visible in the frames, not guessed.
//
// Safe by design: the windows are real people's messengers. Nothing is sent;
// only chats without unread messages are opened; what is typed into search is
// removed again.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'https://platform.siliconvalleyinvestclub.com';
const TARGET = process.env.TARGET || 'whatsapp';
const COOKIE = process.env.MW_COOKIE || '';
const PEOPLE = (process.env.PEOPLE || 'anna mariam daria emma').split(/\s+/).filter(Boolean);
const OUT = 'out';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 860 },
  deviceScaleFactor: 1,
  recordVideo: { dir: OUT, size: { width: 1280, height: 860 } },
  permissions: ['clipboard-read', 'clipboard-write'],
});
await ctx.addCookies([{ name: 'svic_token', value: COOKIE, url: BASE, httpOnly: true, secure: true, sameSite: 'Lax' }]);
const page = await ctx.newPage();
const report = { target: TARGET, person: null, steps: [], startedAt: new Date().toISOString() };

const api = async (path) => {
  const r = await page.request.get(`${BASE}${path}`);
  return r.ok() ? r : null;
};
const status = async (person) => {
  const r = await api(`/api/messengers/console/status?person=${person}&target=${TARGET}`);
  return r ? r.json() : null;
};

let n = 0;
async function snap(name) {
  const tag = `${String(n).padStart(2, '0')}-${name}`;
  await page.screenshot({ path: `${OUT}/${tag}-copy.png` });
  const r = await api(`/api/messengers/console/shot?person=${report.person}&target=${TARGET}`);
  if (r) fs.writeFileSync(`${OUT}/${tag}-server.jpg`, await r.body());
}

async function step(name, fn) {
  const t0 = Date.now();
  let ok = true;
  let note = '';
  try { note = (await fn()) ?? ''; } catch (e) { ok = false; note = String(e.message || e).slice(0, 300); }
  await page.waitForTimeout(1800);
  const stats = await page.evaluate(() => window.SvicWaConsole && window.SvicWaConsole.stats).catch(() => null);
  await snap(name);
  report.steps.push({ n, name, ok, ms: Date.now() - t0, note, stats });
  console.log(`[${n}] ${ok ? 'OK ' : 'ERR'} ${name} — ${typeof note === 'string' ? note : JSON.stringify(note)}`);
  n += 1;
}

// The page's security policy forbids string evaluation, so no waitForFunction.
async function poll(fn, timeout = 10000, every = 100) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('timeout');
    await page.waitForTimeout(every);
  }
}
const frameEl = () => page.$('#wacHost iframe');
const frame = async () => (await frameEl()).contentFrame();
// Page coordinates of an element inside the copy (the copy may be scaled).
async function centerOf(selector, pick = 0) {
  const f = await frame();
  const box = await f.evaluate(({ selector, pick }) => {
    const all = [...document.querySelectorAll(selector)].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height; });
    const e = all[pick];
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, { selector, pick });
  if (!box) throw new Error(`not found: ${selector}`);
  const fb = await (await frameEl()).boundingBox();
  const scale = await page.evaluate(() => {
    const w = document.querySelector('#wacHost .replayer-wrapper');
    const m = w && /scale\(([\d.]+)\)/.exec(w.style.transform || '');
    return m ? Number(m[1]) : 1;
  });
  return { x: fb.x + box.x * scale, y: fb.y + box.y * scale };
}

// 1. Which window: the first linked one nobody is watching, Emma last.
for (const p of PEOPLE) {
  const s = await status(p);
  if (s && s.running && s.linked) { report.person = p; report.viewersBefore = s.viewers; break; }
  if (s && s.running === false) {
    // A sleeping window: wake it by watching for a moment, then ask again.
    await page.goto(`${BASE}/messengers/${p}?app=${TARGET}&console=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(25000);
    const s2 = await status(p);
    if (s2 && s2.linked) { report.person = p; report.viewersBefore = s2.viewers; break; }
    report[`skipped_${p}`] = s2 ? { linked: s2.linked, awaitingLink: s2.awaitingLink } : null;
  }
}
if (!report.person) {
  report.error = 'no linked window';
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await ctx.close(); await browser.close();
  process.exit(0);
}
console.log('window:', report.person, TARGET);

await step('open', async () => {
  const t0 = Date.now();
  await page.goto(`${BASE}/messengers/${report.person}?app=${TARGET}&console=1`, { waitUntil: 'domcontentloaded' });
  await poll(() => page.evaluate(() => Boolean(window.SvicWaConsole && window.SvicWaConsole.stats && window.SvicWaConsole.stats.snapshots > 0)), 90000, 250);
  return { firstPageMs: Date.now() - t0 };
});

await step('quality', async () => {
  const f = await frame();
  return f.evaluate(() => {
    const imgs = [...document.images].filter((i) => { const r = i.getBoundingClientRect(); return r.width > 8 && r.height > 8 && r.bottom > 0 && r.top < innerHeight; });
    const broken = imgs.filter((i) => i.complete && !i.naturalWidth);
    const blobs = imgs.filter((i) => (i.getAttribute('src') || '').startsWith('blob:'));
    const zeroOpacity = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 300 && r.height > 300 && getComputedStyle(e).opacity === '0'; }).length;
    return { visibleImages: imgs.length, broken: broken.length, unresolvedBlob: blobs.length,
      brokenSrc: broken.slice(0, 5).map((i) => (i.getAttribute('src') || '').slice(0, 60)), bigInvisible: zeroOpacity,
      text: document.body.innerText.slice(0, 160) };
  });
});

const LIST = TARGET === 'whatsapp' ? '#pane-side' : '.chatlist-container, #chatlist-container';
await step('scroll-list-down', async () => {
  const c = await centerOf(LIST);
  await page.mouse.move(c.x, c.y);
  for (let i = 0; i < 6; i += 1) { await page.mouse.wheel(0, 400); await page.waitForTimeout(120); }
  const f = await frame();
  return f.evaluate((sel) => { const e = document.querySelector(sel); return { scrollTop: e && e.scrollTop }; }, LIST);
});
await step('scroll-list-up', async () => {
  const c = await centerOf(LIST);
  await page.mouse.move(c.x, c.y);
  for (let i = 0; i < 8; i += 1) { await page.mouse.wheel(0, -500); await page.waitForTimeout(120); }
  return '';
});

await step('hover-row', async () => {
  const c = await centerOf(`${LIST} [role="listitem"], ${LIST} [role="row"], ${LIST} a`, 2);
  await page.mouse.move(c.x, c.y, { steps: 6 });
  return '';
});

// Search: typed, seen on the server, then removed again.
const SEARCH = TARGET === 'whatsapp' ? '#side [contenteditable="true"], #side input[type="text"]' : '.input-search input, input.input-search-input';
await step('search-type', async () => {
  const c = await centerOf(SEARCH);
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(500);
  await page.keyboard.type('zqx', { delay: 120 });
  return '';
});
await step('typing-latency', async () => {
  const t0 = Date.now();
  await page.keyboard.type('k');
  await poll(() => page.evaluate(() => {
    const d = document.querySelector('#wacHost iframe').contentDocument;
    const e = d.querySelector('#side [contenteditable="true"], .input-search input');
    return Boolean(e && ((e.value || '') + (e.textContent || '')).includes('zqxk'));
  }), 8000, 40);
  const ms = Date.now() - t0;
  await page.keyboard.press('Backspace');
  return { keyToScreenMs: ms };
});

await step('search-clear', async () => {
  for (let i = 0; i < 3; i += 1) { await page.keyboard.press('Backspace'); await page.waitForTimeout(150); }
  return '';
});

// A chat with nothing unread (opening it changes nothing for its owner).
await step('open-read-chat', async () => {
  const f = await frame();
  const pick = await f.evaluate((sel) => {
    const rows = [...document.querySelectorAll(`${sel} [role="listitem"], ${sel} [role="row"]`)].filter((r) => r.getBoundingClientRect().height > 40);
    return rows.findIndex((r) => !r.querySelector('[aria-label*="unread" i], .badge, .dialog-subtitle-badge-unread'));
  }, LIST);
  if (pick < 0) throw new Error('no chat without unread');
  const c = await centerOf(`${LIST} [role="listitem"], ${LIST} [role="row"]`, pick);
  await page.mouse.click(c.x, c.y);
  return { row: pick };
});

const MAIN = TARGET === 'whatsapp' ? '#main' : '.bubbles, #column-center';
await step('scroll-messages-up', async () => {
  const c = await centerOf(MAIN);
  await page.mouse.move(c.x, c.y);
  for (let i = 0; i < 6; i += 1) { await page.mouse.wheel(0, -600); await page.waitForTimeout(150); }
  return '';
});

await step('select-and-copy', async () => {
  const sel = TARGET === 'whatsapp' ? '#main span.selectable-text, #main .copyable-text span' : '.bubble .message';
  const c = await centerOf(sel, 0);
  await page.mouse.click(c.x, c.y, { clickCount: 3 });
  await page.waitForTimeout(300);
  const selected = await page.evaluate(() => {
    const d = document.querySelector('#wacHost iframe').contentDocument;
    return String(d.defaultView.getSelection());
  });
  await page.keyboard.press('Control+C');
  await page.waitForTimeout(500);
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => `ERR ${e.message}`);
  return { selected: selected.slice(0, 80), clipboard: String(clip).slice(0, 80), same: selected.trim() === String(clip).trim() };
});

await step('close-chat', async () => { await page.keyboard.press('Escape'); return ''; });

// A row clicked, then text WITH SPACES typed into search: every space must
// reach the search field and nothing else may be clicked again (2026-10-01:
// a space re-pressed the last clicked row in 5.0.1).
await step('row-then-spaces', async () => {
  const c = await centerOf(`${LIST} [role="listitem"], ${LIST} [role="row"]`, 1);
  await page.mouse.move(c.x, c.y);
  const s = await centerOf(SEARCH);
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(500);
  // focus the row in the copy without opening it on the server: a local focus only
  await (await frame()).evaluate((sel) => { const r = document.querySelectorAll(sel)[1]; const f = r && (r.querySelector('[tabindex],a,button') || r); if (f && f.focus) f.focus(); }, `${LIST} [role="listitem"], ${LIST} [role="row"]`);
  const sent = [];
  page.on('request', (r) => { if (r.url().includes('/console/input') || r.url().includes('/console/type')) sent.push(r.postData()); });
  await page.keyboard.type('q w e', { delay: 150 });
  await page.waitForTimeout(1500);
  const clicks = sent.filter((d) => d && d.includes('mousePressed')).length;
  page.removeAllListeners('request');
  for (let i = 0; i < 5; i += 1) { await page.keyboard.press('Backspace'); await page.waitForTimeout(120); }
  return { pressesSentWhileTyping: clicks, inputs: sent.length };
});

report.finishedAt = new Date().toISOString();
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
await ctx.close();
await browser.close();
