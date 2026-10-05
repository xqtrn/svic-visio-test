// Cloud test of the Mac program's Copy / Paste on the TEST window (target=fixture,
// nobody's account). The real program (Electron) runs under Xvfb with a short-lived
// device key; "another app" is xclip, a separate process on the same clipboard.
// Keys go through the program's own shortcut path (before-input-event) and the
// Edit menu, exactly as on a Mac.
import { _electron as electron } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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

const app = await electron.launch({
  cwd: path.resolve('program'),
  args: ['.', '--target=whatsapp-svic', '--no-sandbox'],
  env: { ...process.env, SVIC_USER_DATA: path.resolve('program-profile'), SVIC_DESK_DEVICE_TOKEN: process.env.DESK_DEVICE_TOKEN || '' },
  recordVideo: { dir: OUT, size: { width: 1280, height: 860 } },
});
app.process().stdout.on('data', (d) => process.stdout.write(`[program] ${d}`));
app.process().stderr.on('data', (d) => { const s = String(d); if (!/Gtk|dbus|libva|GLib|Fontconfig/i.test(s)) process.stdout.write(`[program!] ${s}`); });

async function deskPage(timeout = 60000) {
  const t0 = Date.now();
  for (;;) {
    for (const w of app.windows()) { if (/\/messengers\//.test(w.url())) return w; }
    if (Date.now() - t0 > timeout) throw new Error(`no desk window (${app.windows().map((w) => w.url()).join(', ')})`);
    await new Promise((r) => setTimeout(r, 300));
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
const field = () => page.evaluate(() => { const i = document.getElementById('wacInput'); return i ? { shown: getComputedStyle(i).display !== 'none', focused: document.activeElement === i, value: i.value } : null; });
const menuClick = (label) => app.evaluate(({ Menu, BrowserWindow }, label) => {
  const win = BrowserWindow.getAllWindows().find((w) => /\/messengers\//.test(w.webContents.getURL()));
  if (win) win.focus();
  const edit = Menu.getApplicationMenu().items.find((i) => i.label === 'Edit');
  const item = edit.submenu.items.find((i) => i.label === label);
  item.click(undefined, win, undefined);
  return Boolean(item);
}, label);
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

async function check(name, fn) {
  const t0 = Date.now();
  let ok = true; let note = '';
  try { note = (await fn()) ?? ''; } catch (e) { ok = false; note = String(e.message || e).slice(0, 300); }
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

await check('field-opens', async () => {
  const c = await copyCenter('#composer');
  await page.mouse.click(c.x, c.y);
  return poll(async () => { const s = await field(); return s && s.shown && s.focused ? s : null; }, 4000);
});

await check('type-in-field', async () => {
  await page.keyboard.type('alpha beta', { delay: 30 });
  await poll(async () => (await copyText('#composer')) === 'alpha beta', 6000);
  return 'alpha beta on the server';
});

await check('cmd-c-field-to-other-app', async () => {
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Meta+C');
  const got = await poll(async () => { const t = otherAppRead(); return t === 'alpha beta' ? t : null; }, 4000);
  return { otherAppSees: got };
});

await check('cmd-x-field-to-other-app', async () => {
  await otherAppWrite('placeholder');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Meta+X');
  const got = await poll(async () => { const t = otherAppRead(); return t === 'alpha beta' ? t : null; }, 4000);
  expect((await field()).value === '', 'field not emptied by Cut');
  await poll(async () => (await copyText('#composer')) === '', 6000);
  return { otherAppSees: got };
});

await check('cmd-v-other-app-into-field', async () => {
  await otherAppWrite('from another app');
  await page.keyboard.press('Meta+V');
  await poll(async () => (await field()).value === 'from another app', 4000);
  await poll(async () => (await copyText('#composer')) === 'from another app', 6000);
  return 'in the field and on the server';
});

await check('menu-paste-into-field', async () => {
  await otherAppWrite(' + menu');
  await page.keyboard.press('End');
  await menuClick('Paste');
  await poll(async () => (await field()).value === 'from another app + menu', 4000);
  await poll(async () => (await copyText('#composer')) === 'from another app + menu', 6000);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await poll(async () => (await copyText('#composer')) === '', 6000);
  await page.keyboard.press('Escape');
  return 'Edit > Paste';
});

await check('cmd-c-window-selection-to-other-app', async () => {
  await otherAppWrite('placeholder');
  const c = await copyCenter('.msg .selectable-text', 2);
  await page.mouse.click(c.x, c.y, { clickCount: 3 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Meta+C');
  const got = await poll(async () => { const t = otherAppRead(); return /Message number 2\b/.test(t) ? t : null; }, 4000);
  return { otherAppSees: got.trim() };
});

await check('menu-copy-window-selection', async () => {
  await otherAppWrite('placeholder');
  const c = await copyCenter('.msg .selectable-text', 4);
  await page.mouse.click(c.x, c.y, { clickCount: 3 });
  await page.waitForTimeout(500);
  await menuClick('Copy');
  const got = await poll(async () => { const t = otherAppRead(); return /Message number 4\b/.test(t) ? t : null; }, 4000);
  return { otherAppSees: got.trim() };
});

await check('cmd-v-other-app-into-plain-input', async () => {
  await otherAppWrite('abc 123');
  const c = await copyCenter('#inp');
  await page.mouse.click(c.x, c.y);
  await poll(async () => { const s = await field(); return s && s.shown && s.focused ? s : null; }, 4000);
  await page.keyboard.press('Meta+V');
  await poll(async () => (await copyText('#inp')) === 'abc 123', 6000);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await poll(async () => (await copyText('#inp')) === '', 6000);
  await page.keyboard.press('Escape');
  return 'abc 123';
});

await check('nothing-sent-by-copy-paste', async () => {
  const sent = await copyText('#sent');
  expect(sent === '0', `a message was sent: ${sent}`);
  return { sent };
});

report.ok = report.failures === 0;
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
await page.evaluate(() => window.SvicWaConsole && window.SvicWaConsole.unmount()).catch(() => {});
await app.close();
console.log(report.ok ? 'ALL PASS' : `FAILURES: ${report.failures}`);
process.exit(report.ok ? 0 : 1);
