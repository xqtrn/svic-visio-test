// Cloud test of the Mac program's Copy / Paste on the TEST window (target=fixture,
// nobody's account). The real program (Electron) runs under Xvfb with a short-lived
// device key; "another app" is xclip, a separate process on the same clipboard.
// Keys go through the program's own shortcut path (before-input-event) and the
// Edit menu, exactly as on a Mac.
import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const DESK = process.env.DESK || 'emma';
const OUT = path.resolve('out');
fs.mkdirSync(OUT, { recursive: true });
const report = { steps: [], failures: 0 };
let n = 0;

// "Another app": xclip reads and owns the X clipboard as its own process.
const otherAppRead = () => { try { return execFileSync('xclip', ['-selection', 'clipboard', '-o'], { timeout: 4000 }).toString(); } catch (_) { return ''; } };
const otherAppWrite = (text) => new Promise((resolve) => {
  const p = spawn('xclip', ['-selection', 'clipboard', '-i'], { stdio: ['pipe', 'ignore', 'ignore'], detached: true });
  p.stdin.end(text); p.unref(); setTimeout(resolve, 400);
});

// The program is started as on a Mac (no test harness inside it): its windows
// are reached over the DevTools port, its main process over the Node inspector.
const ELECTRON = createRequire(path.resolve('program/package.json'))('electron');
const proc = spawn(ELECTRON, ['.', '--target=whatsapp-svic', '--no-sandbox', '--remote-debugging-port=9333', '--inspect=9339'], {
  cwd: path.resolve('program'),
  env: { ...process.env, SVIC_USER_DATA: path.resolve('program-profile'), SVIC_DESK_DEVICE_TOKEN: process.env.DESK_DEVICE_TOKEN || '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
proc.stdout.on('data', (d) => process.stdout.write(`[program] ${d}`));
proc.stderr.on('data', (d) => { const s = String(d); if (!/Gtk|dbus|libva|GLib|Fontconfig|Debugger|devtools|inspector/i.test(s)) process.stdout.write(`[program!] ${s}`); });
proc.on('exit', (code, sig) => console.log(`[program exit] ${code} ${sig}`));

async function waitJson(url, timeout = 60000) {
  const t0 = Date.now();
  for (;;) {
    try { const r = await fetch(url); if (r.ok) return r.json(); } catch (_) { /* not up yet */ }
    if (Date.now() - t0 > timeout) throw new Error(`no answer from ${url}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}
// Main-process calls through the Node inspector (Runtime.evaluate).
const inspector = (await waitJson('http://127.0.0.1:9339/json/list'))[0].webSocketDebuggerUrl;
const mainWs = new WebSocket(inspector);
await new Promise((r) => mainWs.addEventListener('open', r, { once: true }));
let msgId = 0;
function mainEval(expression) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      mainWs.removeEventListener('message', onMsg);
      if (m.result && m.result.exceptionDetails) reject(new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 300)));
      else resolve(m.result && m.result.result && m.result.result.value);
    };
    mainWs.addEventListener('message', onMsg);
    mainWs.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
}

await waitJson('http://127.0.0.1:9333/json/version', 90000);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
async function deskPage(timeout = 150000) {
  const t0 = Date.now();
  for (;;) {
    for (const c of browser.contexts()) for (const p of c.pages()) { if (/\/messengers\//.test(p.url())) return p; }
    if (Date.now() - t0 > timeout) throw new Error(`no desk window (${browser.contexts().flatMap((c) => c.pages().map((p) => p.url())).join(', ')})`);
    await new Promise((r) => setTimeout(r, 500));
  }
}
const page = await deskPage();

async function poll(fn, timeout = 8000, every = 100) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('timeout');
    await page.waitForTimeout(every);
  }
}
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
const caret = () => page.evaluate(() => {
  const d = document.querySelector('#wacHost iframe').contentDocument;
  const sel = d.getSelection();
  const n = sel && sel.anchorNode;
  const host = n && (n.nodeType === 1 ? n : n.parentElement);
  return { focused: d.hasFocus(), inComposer: Boolean(host && host.closest && host.closest('#composer')) };
});
const menuClick = (label) => mainEval(`(() => {
  const { Menu, BrowserWindow } = process.mainModule.require('electron');
  const win = BrowserWindow.getAllWindows().find((w) => /\\/messengers\\//.test(w.webContents.getURL()));
  if (win) win.focus();
  const edit = Menu.getApplicationMenu().items.find((i) => i.label === 'Edit');
  const item = edit.submenu.items.find((i) => i.label === ${JSON.stringify(label)});
  const before = { focused: (BrowserWindow.getFocusedWindow() || {}).id || null, win: win && win.id, all: BrowserWindow.getAllWindows().map((w) => w.id + ':' + w.webContents.getURL().replace(/^https:\\/\\/[^/]+/, '')) };
  item.click(undefined, win, undefined);
  return before;
})()`);
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

async function check(name, fn) {
  const t0 = Date.now();
  let ok = true; let note = '';
  try { note = (await fn()) ?? ''; } catch (e) { ok = false; note = String(e.message || e).slice(0, 200) + ' ' + JSON.stringify(await Promise.resolve().then(() => diag()).catch(() => ({}))).slice(0, 400); }
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}.png` }).catch(() => {});
  if (!ok) report.failures += 1;
  report.steps.push({ n, name, ok, ms: Date.now() - t0, note });
  console.log(`[${n}] ${ok ? 'PASS' : 'FAIL'} ${name} — ${typeof note === 'string' ? note : JSON.stringify(note)}`);
  n += 1;
}

await check('program-opens-test-window', async () => {
  await poll(() => page.evaluate(() => Boolean(window.SvicWaConsole && window.SvicWaConsole.mount && window.SvicWaConsole.editTarget)), 60000, 300);
  await page.evaluate((desk) => { window.SvicWaConsole.unmount(); return window.SvicWaConsole.mount({ desk, target: 'fixture' }); }, DESK);
  await poll(async () => (await copyText('#log')) !== null, 60000, 200);
  return { url: page.url().replace(/\?.*/, '') };
});

await check('clipboard-diagnostics', async () => {
  const out = {};
  out.api = await mainEval(`(() => { const { clipboard } = process.mainModule.require('electron'); return Object.keys(Object.getPrototypeOf(clipboard) || {}).concat(Object.keys(clipboard)).slice(0, 40).join(','); })()`).catch((e) => e.message);
  out.write = await mainEval(`(async () => { const { clipboard } = process.mainModule.require('electron'); const r = clipboard.writeText('from program'); return String(r && r.then ? 'promise' : typeof r); })()`).catch((e) => e.message);
  await new Promise((r) => setTimeout(r, 500));
  out.otherAppReads = otherAppRead();
  await otherAppWrite('from xclip');
  out.programReads = await mainEval(`(async () => { const { clipboard } = process.mainModule.require('electron'); return String(await clipboard.readText()); })()`).catch((e) => e.message);
  out.editTarget = await page.evaluate(() => window.SvicWaConsole.editTarget());
  out.ozone = await mainEval(`process.argv.join(' ') + ' | ' + (process.env.XDG_SESSION_TYPE || '') + ' | ' + (process.env.DISPLAY || '')`).catch((e) => e.message);
  return out;
});

await mainEval(`(() => { const { BrowserWindow } = process.mainModule.require('electron'); global.__keys = []; for (const w of BrowserWindow.getAllWindows()) w.webContents.on('before-input-event', (e, i) => { if (i.type === 'keyDown') global.__keys.push([i.key, i.meta, i.control, i.alt, i.shift].join(':')); }); return true; })()`);
const keysSeen = () => mainEval('JSON.stringify((global.__keys || []).splice(0))');
// Shortcuts are real X key presses (as a Mac keyboard reaches the program),
// not DevTools keys: those never pass the program's own shortcut hook.
async function realKey(combo) {
  await mainEval(`(() => { const { BrowserWindow } = process.mainModule.require('electron'); const w = BrowserWindow.getAllWindows().find((x) => /\\/messengers\\//.test(x.webContents.getURL())); if (w) w.focus(); return true; })()`);
  try {
    const ids = execFileSync('xdotool', ['search', '--pid', String(proc.pid)], { timeout: 4000 }).toString().trim().split(/\s+/).filter(Boolean);
    for (const id of ids) { try { execFileSync('xdotool', ['windowfocus', '--sync', id], { timeout: 3000 }); break; } catch (_) { /* next */ } }
  } catch (_) { /* focus by the program only */ }
  execFileSync('xdotool', ['key', '--clearmodifiers', combo], { timeout: 4000 });
  await page.waitForTimeout(300);
}
const diag = async () => ({ programHas: await mainEval(`(async () => String(await process.mainModule.require('electron').clipboard.readText()))()`).catch((e) => e.message), pageGives: await page.evaluate(() => window.SvicWaConsole.selectedText()).catch((e) => e.message), composer: await copyText('#composer').catch(() => null), other: otherAppRead(), keys: await keysSeen(), sel: await page.evaluate(() => String(document.querySelector('#wacHost iframe').contentDocument.defaultView.getSelection())).catch(() => '') });

let sentAtStart = 0;
await check('click-puts-caret-in-field', async () => {
  sentAtStart = Number(await copyText('#sent')) || 0;
  const c = await copyCenter('#composer', 0, 0.15);
  await page.mouse.click(c.x, c.y);
  const st = await poll(async () => { const s = await caret(); return s.focused && s.inComposer ? s : null; }, 4000);
  await realKey('super+a');
  await realKey('BackSpace');
  await poll(async () => (await copyText('#composer')) === '', 6000);
  return st;
});

await check('real-keyboard-types-in-window', async () => {
  await mainEval(`(() => { const { BrowserWindow } = process.mainModule.require('electron'); const w = BrowserWindow.getAllWindows().find((x) => /\\/messengers\\//.test(x.webContents.getURL())); if (w) w.focus(); return true; })()`);
  const t0 = Date.now();
  execFileSync('xdotool', ['type', '--delay', '40', 'alpha beta'], { timeout: 10000 });
  await poll(async () => (await copyText('#composer')) === 'alpha beta', 8000, 40);
  return { onScreenAfterMs: Date.now() - t0 };
});

await check('cmd-arrow-and-option-arrow', async () => {
  await realKey('super+Left');          // line start
  execFileSync('xdotool', ['type', '--delay', '40', '1 '], { timeout: 5000 });
  await poll(async () => (await copyText('#composer')) === '1 alpha beta', 6000);
  await realKey('super+Right');         // line end
  // Option on a Linux test desktop opens the program's menu bar (never on a
  // Mac), so the Option key itself is pressed at the page.
  await page.evaluate(() => {
    const d = document.querySelector('#wacHost iframe').contentDocument;
    (d.activeElement || d.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', altKey: true, bubbles: true, cancelable: true }));
  });
  await poll(async () => (await copyText('#composer')) === '1 alpha ', 6000);
  execFileSync('xdotool', ['type', '--delay', '40', 'beta'], { timeout: 5000 });
  await poll(async () => (await copyText('#composer')) === '1 alpha beta', 6000);
  return '1 alpha beta';
});

await check('cmd-a-cmd-c-to-other-app', async () => {
  await otherAppWrite('placeholder');
  await realKey('super+a');
  await page.waitForTimeout(500);
  await realKey('super+c');
  const got = await poll(async () => { const t = otherAppRead().replace(/\u00a0/g, ' '); return t === '1 alpha beta' ? t : null; }, 5000);
  return { otherAppSees: got };
});

await check('cmd-v-other-app-into-window', async () => {
  await otherAppWrite('from another app');
  await realKey('super+a');
  await realKey('super+v');
  await poll(async () => (await copyText('#composer')) === 'from another app', 6000);
  return 'from another app';
});

await check('menu-paste-into-window', async () => {
  await otherAppWrite(' + menu');
  await realKey('End');
  await menuClick('Paste');
  await poll(async () => (await copyText('#composer')) === 'from another app + menu', 6000);
  return 'Edit > Paste';
});

await check('typing-continues-after-reconnect', async () => {
  const before = await page.evaluate(() => window.SvicWaConsole.stats.snapshots);
  await page.evaluate(() => window.SvicWaConsole.reconnect());
  await poll(async () => (await page.evaluate(() => window.SvicWaConsole.stats.snapshots)) > before, 20000, 200);
  await page.waitForTimeout(500);
  const sent0 = await page.evaluate(() => window.SvicWaConsole.stats.sent);
  execFileSync('xdotool', ['type', '--delay', '40', '!'], { timeout: 5000 });
  await page.waitForTimeout(1500);
  const sentBy = (await page.evaluate(() => window.SvicWaConsole.stats.sent)) - sent0;
  const now = await copyText('#composer');
  expect(now === 'from another app + menu!', `after one key: "${now}", sent ${sentBy} events, keys ${await keysSeen()}`);
  await realKey('super+a');
  await realKey('BackSpace');
  await poll(async () => (await copyText('#composer')) === '', 6000);
  return 'kept typing in the same field';
});

await check('cmd-c-window-selection-to-other-app', async () => {
  await otherAppWrite('placeholder');
  const c = await copyCenter('.msg .selectable-text', 2);
  await page.mouse.click(c.x, c.y, { clickCount: 3 });
  await page.waitForTimeout(600);
  await realKey('super+c');
  const got = await poll(async () => { const t = otherAppRead(); return /Message number 2\b/.test(t) ? t : null; }, 5000);
  return { otherAppSees: got.trim() };
});

await check('menu-copy-window-selection', async () => {
  await otherAppWrite('placeholder');
  const c = await copyCenter('.msg .selectable-text', 4);
  await page.mouse.click(c.x, c.y, { clickCount: 3 });
  await page.waitForTimeout(600);
  await menuClick('Copy');
  const got = await poll(async () => { const t = otherAppRead(); return /Message number 4\b/.test(t) ? t : null; }, 5000);
  return { otherAppSees: got.trim() };
});

await check('cmd-v-other-app-into-plain-input', async () => {
  await otherAppWrite('abc 123');
  const c = await copyCenter('#inp');
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(400);
  await realKey('super+a');
  await realKey('BackSpace');
  await poll(async () => (await copyText('#inp')) === '', 6000);
  await realKey('super+v');
  await poll(async () => (await copyText('#inp')) === 'abc 123', 6000);
  await realKey('super+a');
  await realKey('BackSpace');
  await poll(async () => (await copyText('#inp')) === '', 6000);
  return 'abc 123';
});

await check('window-copy-button-to-other-app', async () => {
  const out = {};
  for (const [sel, want] of [['#copy-new', 'Copied by the window: async'], ['#copy-old', 'Copied by the window: command']]) {
    await otherAppWrite('placeholder');
    const c = await copyCenter(sel);
    await page.mouse.click(c.x, c.y);
    out[sel] = await poll(async () => { const t = otherAppRead(); return t === want ? t : null; }, 5000);
  }
  return out;
});

await check('nothing-sent-by-copy-paste', async () => {
  const sent = Number(await copyText('#sent')) || 0;
  expect(sent === sentAtStart, `a message was sent: ${sent - sentAtStart}`);
  return { sent };
});

report.ok = report.failures === 0;
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
await page.evaluate(() => window.SvicWaConsole && window.SvicWaConsole.unmount()).catch(() => {});
await browser.close().catch(() => {});
proc.kill('SIGTERM');
console.log(report.ok ? 'ALL PASS' : `FAILURES: ${report.failures}`);
process.exit(report.ok ? 0 : 1);
