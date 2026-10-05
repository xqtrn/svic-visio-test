'use strict';

// "WhatsApp SVIC" / "Telegram SVIC" — the messenger programs of the desk on the Mac.
//
// Arthur 2026-09-28: "the data is on the server, isn't it". Each person's ONE WhatsApp and
// ONE Telegram sign-in lives on her bridge server, which already receives and
// sends every message for the platform. This program only SHOWS that desk: it
// opens the platform's Messenger Desk in program mode (?app=<channel>) for the
// person chosen in the Edit menu. There is no QR code per Mac, no hand-over,
// and any number of Macs show the same chats at once.
//
// 2.x ran its own WhatsApp Web / Telegram Web per person on every Mac (a new
// linked device each time, tunnelled through her server). That was wrong for
// the team: a second Mac always asked for a QR code. 3.0 removes it and clears
// the old local sign-ins on first start.
//
// WHO may be opened is decided by the platform on every call (the same desk
// access as the web desk), never by this program. The program is a DEVICE of
// a person: it holds its own key, issued once on the apps page (pairing),
// revocable there. The key buys the owner's own platform session — the same
// one she gets by signing in on the website. The server's internal key never
// ships inside the program.
//
// 5.0 (Arthur 2026-10-01: "one window on the server that every computer
// shows the same, through a proxy"): the window is the person's ONE
// WhatsApp / Telegram running on her server, and this program shows its live
// PAGE — real text, native scrolling, selection and copy — not a picture of
// it (3.1 streamed pictures and was rejected as "a video stream"; 4.0 ran a
// separate sign-in per Mac and asked every Mac for a QR code). The
// administrator links each server window once; every Mac then opens it as is.
//
// Copying / re-signing WhatsApp.app or opening its containers is FORBIDDEN
// (2026-09-02: such a copy opened Arthur's key store and broke all his chats).

const {
  app, BrowserWindow, Menu, session, shell, dialog, ipcMain, Notification, clipboard,
} = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

function loadTarget() {
  const arg = process.argv.find((a) => a.startsWith('--target='));
  const packaged = path.join(process.resourcesPath || '', 'target.json');
  const file = arg
    ? path.join(__dirname, 'targets', `${arg.slice('--target='.length)}.json`)
    : (fs.existsSync(packaged) ? packaged : path.join(__dirname, 'targets', 'whatsapp-svic.json'));
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const TARGET = loadTarget();
const APP_NAME = TARGET.name;
const APP_VERSION = (() => {
  try { return require('./package.json').version || '0.0.0'; } catch (_) { return '0.0.0'; }
})();
const CHANNEL = TARGET.channel;
const CHANNEL_LABEL = TARGET.channelLabel || (CHANNEL === 'telegram' ? 'Telegram' : 'WhatsApp');
const SCHEME = TARGET.scheme;
const PLATFORM_BASE = (process.env.SVIC_PLATFORM_BASE || TARGET.platformBase || 'https://platform.siliconvalleyinvestclub.com').replace(/\/$/, '');
const PLATFORM_ORIGIN = new URL(PLATFORM_BASE).origin;
const PLATFORM_PARTITION = 'persist:svic-platform';
const UNREAD_MS = 20000;
const HEARTBEAT_MS = 5 * 60000;
const SESSION_REFRESH_MS = 12 * 3600 * 1000;
const UPDATE_CHECK_MS = 6 * 3600 * 1000;
const SELFTEST = process.argv.includes('--selftest');
const SHOT = (process.argv.find((a) => a.startsWith('--shot=')) || '').slice(7);
const SELFTEST_PERSON = (process.argv.find((a) => a.startsWith('--person=')) || '').slice(9);
const PEOPLE_ORDER = ['emma', 'daria', 'mariam', 'anna'];

app.setName(APP_NAME);
// SVIC_USER_DATA isolates a self-test run from the real profile.
const TEST_PROFILE = process.env.SVIC_USER_DATA || '';
app.setPath('userData', TEST_PROFILE || path.join(app.getPath('appData'), APP_NAME));
const USER_DATA = app.getPath('userData');
const DEVICE_FILE = path.join(USER_DATA, 'device.json');
const PREFS_FILE = path.join(USER_DATA, 'prefs.json');

const state = {
  device: null, me: null, people: [], current: null, unread: {},
  win: null, pairWin: null, pairingState: null, booting: false, quitting: false,
  cursor: 0, notified: new Set(), timers: [], updateReady: null,
};

// ---------------------------------------------------------------------------
// Small helpers

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
}

function loadDevice() {
  const dev = process.env.SVIC_DESK_DEVICE_TOKEN
    ? { token: process.env.SVIC_DESK_DEVICE_TOKEN }
    : readJson(DEVICE_FILE);
  return dev && dev.token ? dev : null;
}

function platformRequest(method, urlPath, { body = null, headers = {}, raw = false, timeoutMs = 20000 } = {}) {
  const u = new URL(urlPath, `${PLATFORM_BASE}/`);
  const lib = u.protocol === 'https:' ? https : http;
  const hdrs = { 'User-Agent': `${APP_NAME}/${APP_VERSION} (${os.hostname()})`, ...headers };
  if (state.device && state.device.token) hdrs['x-desk-device'] = state.device.token;
  let payload = null;
  if (body != null) {
    payload = Buffer.from(JSON.stringify(body));
    hdrs['Content-Type'] = 'application/json';
    hdrs['Content-Length'] = String(payload.length);
  }
  return new Promise((resolve, reject) => {
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method, headers: hdrs, timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (raw) return resolve({ status: res.statusCode, headers: res.headers, body: buf });
        let json = null;
        try { json = JSON.parse(buf.toString('utf8')); } catch (_) { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, json, text: buf.toString('utf8') });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('platform timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} failed: ${stderr || err.message}`));
      resolve(stdout);
    });
  });
}

// ---------------------------------------------------------------------------
// People and the desk address

function person(key) { return state.people.find((p) => p.key === key) || null; }
function currentPerson() { return person(state.current); }

function deskUrl(key, extra = {}) {
  const u = new URL(`/messengers/${encodeURIComponent(key)}`, `${PLATFORM_BASE}/`);
  u.searchParams.set('app', CHANNEL);
  // The window IS the person's own WhatsApp / Telegram running on her server;
  // its live page is drawn here (wa-console.js), no QR on this Mac. The
  // administrator links each server window once by scanning its code.
  u.searchParams.set('console', '1');
  for (const [k, v] of Object.entries(extra)) if (v != null && v !== '') u.searchParams.set(k, String(v));
  return u.toString();
}

// The desk itself stays in the window; login pages mean the session expired
// (the program signs in again); every other address opens in the browser.
function isDeskUrl(url) {
  try {
    const u = new URL(url);
    return u.origin === PLATFORM_ORIGIN && /^\/messengers\/(?!apps(\/|$)|team(\/|$))[a-z]+/i.test(u.pathname);
  } catch (_) { return false; }
}
function isLoginUrl(url) {
  try {
    const u = new URL(url);
    return u.origin === PLATFORM_ORIGIN && /^\/(login|welcome|auth)(\/|$)/i.test(u.pathname);
  } catch (_) { return false; }
}

// ---------------------------------------------------------------------------
// The platform session inside the program's window

function platformSession() {
  const ses = session.fromPartition(PLATFORM_PARTITION);
  if (!ses.__svicReady) {
    const allowed = new Set(['notifications', 'media', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);
    ses.setPermissionRequestHandler((wc, permission, cb) => cb(allowed.has(permission)));
    ses.setPermissionCheckHandler((wc, permission) => allowed.has(permission));
    ses.__svicReady = true;
  }
  return ses;
}

/** Trades the device key for its owner's platform session, set in the window's cookie jar. */
async function signInWeb() {
  const r = await platformRequest('POST', '/api/messenger-apps/web-session');
  if (r.status === 401) throw Object.assign(new Error('unpaired'), { code: 'unpaired' });
  if (r.status !== 200 || !r.json || !r.json.token) throw new Error((r.json && r.json.error) || `web-session ${r.status}`);
  const secure = PLATFORM_BASE.startsWith('https:');
  const ses = platformSession();
  const name = r.json.cookieName || 'svic_token';
  // Host-only, like the platform's own sign-in (2026-09-12 canon): a
  // parent-domain copy next to it broke sign-in on iPhone. The previous
  // cookie is removed first so a refresh never leaves two with one name.
  try { await ses.cookies.remove(PLATFORM_BASE, name); } catch (_) { /* none yet */ }
  const cookie = {
    url: PLATFORM_BASE,
    name,
    value: r.json.token,
    path: '/',
    secure,
    httpOnly: true,
    sameSite: 'lax',
    expirationDate: Math.floor(Date.now() / 1000) + (Number(r.json.maxAgeSeconds) || 7 * 86400),
  };
  await ses.cookies.set(cookie);
  state.signedInAt = Date.now();
}

// 2.x kept a WhatsApp Web / Telegram Web sign-in per person on this Mac.
// They are not used any more: removed once, so no second copy lingers here.
function retireLocalMessengerSignIns() {
  if (TEST_PROFILE) return 0;
  const dir = path.join(USER_DATA, 'Partitions');
  let removed = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch (_) { return 0; }
  for (const name of entries) {
    if (!/^person-[a-z]+$/.test(name)) continue;
    try { fs.rmSync(path.join(dir, name), { recursive: true, force: true }); removed += 1; } catch (_) { /* next start retries */ }
  }
  for (const leftover of ['handover-stage', 'handover.zip', 'claim.zip']) {
    try { fs.rmSync(path.join(USER_DATA, leftover), { recursive: true, force: true }); } catch (_) { /* noop */ }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Window

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: '#f5f7fa',
    show: false,
    webPreferences: {
      partition: PLATFORM_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  const wc = win.webContents;
  win.once('ready-to-show', () => win.show());
  // The page title belongs to the program, not to the platform page.
  win.on('page-title-updated', (e) => { e.preventDefault(); updateTitle(); });
  wc.setWindowOpenHandler(({ url }) => {
    if (isDeskUrl(url)) {
      const u = new URL(url);
      u.searchParams.set('app', CHANNEL);
      wc.loadURL(u.toString());
      return { action: 'deny' };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // The live window swallows every key it gets (they belong to WhatsApp /
  // Telegram), and in Electron the page sees a key BEFORE the menu. So the
  // program's own shortcuts are taken here, before the page, and every other
  // key still reaches the messenger (review 2026-09-28).
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.meta || input.alt) return;
    const key = String(input.key || '').toLowerCase();
    const act = programShortcut(key, input);
    if (!act) return;
    event.preventDefault();
    act();
  });
  wc.on('will-navigate', (e, url) => {
    if (url.startsWith('file:') || isDeskUrl(url) || isLoginUrl(url)) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  // An expired or refused session lands on the platform's sign-in page:
  // the program signs itself in again and returns to the desk.
  wc.on('did-navigate', (_e, url) => {
    if (!isLoginUrl(url)) return;
    // At most two fresh sign-ins in two minutes: a server that keeps refusing
    // the session gets an honest error page, not an endless loop.
    const now = Date.now();
    state.reSignIns = (state.reSignIns || []).filter((t) => now - t < 120000);
    if (state.reSignIns.length >= 2) {
      showError('The platform keeps refusing this program. Quit it (⌘Q) and open it again; if it repeats, disconnect this Mac on the apps page and allow it again.');
      return;
    }
    state.reSignIns.push(now);
    const key = state.current;
    signInWeb()
      .then(() => { if (key) wc.loadURL(deskUrl(key)); })
      .catch((err) => {
        if (err.code === 'unpaired') forgetAndPair('This Mac was disconnected on the apps page. Connect it again to continue.');
        else showError('The platform did not let the program in. Quit the program (⌘Q) and open it again.');
      });
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3: aborted by our own navigation
    showError(`The desk did not load (${desc}). Check the internet; the program retries in a minute.`);
    setTimeout(() => { if (state.current && state.win) state.win.loadURL(deskUrl(state.current)); }, 60000);
  });
  win.on('closed', () => { state.win = null; });
  state.win = win;
  return win;
}

function showError(message) {
  const win = state.win || createWindow();
  win.loadFile(path.join(__dirname, 'error.html'), { query: { msg: message, app: APP_NAME } });
  win.show();
  if (SELFTEST) {
    console.log(JSON.stringify({ ok: false, error: message }));
    setTimeout(() => app.exit(1), 500);
  }
}

function selectPerson(key, extra = {}) {
  const p = person(key);
  if (!p || !state.win || state.win.isDestroyed()) return;
  state.current = key;
  writeJson(PREFS_FILE, { ...readJson(PREFS_FILE, {}), person: key });
  state.win.loadURL(deskUrl(key, extra));
  state.win.show();
  updateTitle();
  buildMenu();
}

function updateTitle() {
  if (!state.win || state.win.isDestroyed()) return;
  const p = currentPerson();
  state.win.setTitle(p && state.people.length > 1 ? `${APP_NAME} — ${p.name}` : APP_NAME);
}

// ---------------------------------------------------------------------------
// Unread chats, Dock badge, notifications — read from the platform, per person.

function unreadChats(key) { return (state.unread[key] && state.unread[key].chats) || 0; }

function refreshBadge() {
  if (!app.dock) return;
  const total = state.people.reduce((n, p) => n + unreadChats(p.key), 0);
  app.dock.setBadge(total ? String(total) : '');
}

function notify(item) {
  if (state.notified.has(item.sid)) return;
  state.notified.add(item.sid);
  if (state.notified.size > 500) state.notified = new Set([...state.notified].slice(-250));
  const focused = state.win && !state.win.isDestroyed() && state.win.isFocused();
  if (focused && item.person === state.current) return;
  if (!Notification.isSupported()) return;
  const p = person(item.person);
  const n = new Notification({
    title: item.chat || CHANNEL_LABEL,
    subtitle: state.people.length > 1 && p ? p.name : undefined,
    body: item.sender && item.sender !== item.chat ? `${item.sender}: ${item.text}` : item.text,
    silent: false,
  });
  n.on('click', () => {
    if (!state.win || state.win.isDestroyed()) createWindow();
    selectPerson(item.person, item.conversation ? { chat: item.conversation } : {});
    state.win.focus();
  });
  n.show();
}

async function pollUnread() {
  try {
    const r = await platformRequest('GET', `/api/messenger-apps/unread?since=${state.cursor || 0}`);
    if (r.status === 401) return forgetAndPair('This Mac was disconnected on the apps page. Connect it again to continue.');
    if (r.status !== 200 || !r.json) return;
    const first = !state.cursor;
    state.unread = r.json.people || {};
    if (!first) (r.json.fresh || []).slice().reverse().forEach(notify);
    if (r.json.cursor) state.cursor = Math.max(state.cursor || 0, Number(r.json.cursor) || 0);
    refreshBadge();
    buildMenu();
  } catch (_) { /* next tick */ }
}

async function heartbeat() {
  try {
    await platformRequest('POST', '/api/messenger-apps/heartbeat', {
      body: { appVersion: APP_VERSION, signedIn: state.people.map((p) => p.key) },
    });
  } catch (_) { /* advisory */ }
}

// ---------------------------------------------------------------------------
// Menu: the person is chosen in Edit (Arthur 2026-09-26), also Cmd+1…4 and the Dock.

function personItems() {
  return state.people.map((p, i) => ({
    label: unreadChats(p.key) ? `${p.name} (${unreadChats(p.key)})` : p.name,
    type: 'radio',
    checked: p.key === state.current,
    accelerator: i < 9 ? `CmdOrCtrl+${i + 1}` : undefined,
    click: () => selectPerson(p.key),
  }));
}

function programShortcut(key, input) {
  if (/^[1-9]$/.test(key) && !input.control) {
    const p = state.people[Number(key) - 1];
    return p && state.people.length > 1 ? () => selectPerson(p.key) : null;
  }
  if (input.control) return key === 'f' ? () => state.win && state.win.setFullScreen(!state.win.isFullScreen()) : null;
  // Copy / Paste are taken here only while the live window is on screen; on
  // the sign-in pages they stay ordinary keys for the menu's own Copy/Paste.
  if ((key === 'c' || key === 'v' || key === 'x') && !consoleOnScreen()) return null;
  const map = {
    c: () => consoleCall('copy'),
    v: () => consoleCall('paste'),
    x: () => consoleCall('cut'),
    r: () => viewCall((wc) => wc.reload()),
    q: () => app.quit(),
    h: () => app.hide(),
    w: () => state.win && state.win.close(),
    m: () => state.win && state.win.minimize(),
    0: () => viewCall((wc) => wc.setZoomLevel(0)),
    '=': () => viewCall((wc) => wc.setZoomLevel(wc.getZoomLevel() + 0.5)),
    '+': () => viewCall((wc) => wc.setZoomLevel(wc.getZoomLevel() + 0.5)),
    '-': () => viewCall((wc) => wc.setZoomLevel(wc.getZoomLevel() - 0.5)),
  };
  return map[key] || null;
}

// The live window is the desk page opened with console=1 (not a sign-in page).
function consoleOnScreen(wc = state.win && !state.win.isDestroyed() ? state.win.webContents : null) {
  if (!wc) return false;
  try {
    const u = new URL(wc.getURL());
    return isDeskUrl(u.toString()) && u.searchParams.get('console') === '1';
  } catch (_) { return false; }
}

// Edit > Copy / Paste act on the window in front: through the live window's
// clipboard bridge when it is showing, as a plain copy/paste anywhere else
// (the pairing window's code field, the sign-in pages).
function editCall(action) {
  const win = BrowserWindow.getFocusedWindow();
  const wc = win && !win.isDestroyed() ? win.webContents : null;
  if (!wc) return;
  if (state.win && win === state.win && consoleOnScreen(wc)) return consoleCall(action);
  if (action === 'paste') wc.paste(); else if (action === 'cut') wc.cut(); else wc.copy();
}

// Copy / Paste of the live window go through the Mac's own clipboard, held by
// the program: the page's clipboard is refused while the cursor sits in the
// window's copy (Arthur 2026-10-05: "copy-paste does not work between the
// window and other windows"). In the native typing field they are the Mac's
// own editing commands; in the window the program takes the selected text
// and hands pasted text over. Text only.
function pageCall(wc, expr) {
  return wc.executeJavaScript(`(async () => { const c = window.SvicWaConsole; if (!c || !c.editTarget) return null; ${expr} })()`, true)
    .catch(() => null);
}

async function consoleEdit(wc, action) {
  const target = await pageCall(wc, 'return c.editTarget();');
  if (target === null) {
    // A copy page without the program hooks: its own Copy / Paste.
    return wc.executeJavaScript(
      `window.SvicWaConsole && window.SvicWaConsole.${action === 'paste' ? 'paste' : 'copy'} && window.SvicWaConsole.${action === 'paste' ? 'paste' : 'copy'}()`,
      true,
    ).catch(() => {});
  }
  if (target === 'field') {
    if (action === 'paste') wc.paste(); else if (action === 'cut') wc.cut(); else wc.copy();
    return null;
  }
  if (action === 'paste') {
    // This Electron's clipboard may answer with a promise: always awaited.
    const text = String((await clipboard.readText()) || '');
    if (text) await pageCall(wc, `return c.pasteFromProgram(${JSON.stringify(text)});`);
    return null;
  }
  const text = await pageCall(wc, 'return await c.selectedText();');
  if (text && typeof text === 'string') await clipboard.writeText(text);
  return null;
}

function consoleCall(action) {
  viewCall((wc) => { consoleEdit(wc, action).catch(() => {}); });
}

function viewCall(fn) {
  if (state.win && !state.win.isDestroyed()) fn(state.win.webContents);
}

function buildMenu() {
  const people = personItems();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: APP_NAME,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Check for Updates…', click: () => checkForUpdates(true) },
        { label: 'Disconnect This Mac…', click: () => forgetDevice() },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      // In the live window the page gets every key first and forwards it to
      // the server's messenger, so these items never steal its keys; the
      // program's own keys (Cmd+1..9, R, Q, H, W, M, zoom, and C/V/X while the
      // live window shows) are taken before the page in before-input-event.
      // Everywhere else (pairing, sign-in pages) they work as usual.
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', click: () => editCall('cut') },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', click: () => editCall('copy') },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', click: () => editCall('paste') },
        { role: 'selectAll' },
        ...(people.length > 1 ? [{ type: 'separator' }, { label: 'Person', enabled: false }, ...people] : []),
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => viewCall((wc) => wc.reload()) },
        { type: 'separator' },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => viewCall((wc) => wc.setZoomLevel(0)) },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => viewCall((wc) => wc.setZoomLevel(wc.getZoomLevel() + 0.5)) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => viewCall((wc) => wc.setZoomLevel(wc.getZoomLevel() - 0.5)) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]));
  if (app.dock) app.dock.setMenu(Menu.buildFromTemplate(people.length > 1 ? people.map((item) => ({ ...item, accelerator: undefined })) : []));
}

// ---------------------------------------------------------------------------
// Pairing (first launch, or after this Mac was disconnected)

function pairPageUrl(stateToken) {
  return `${PLATFORM_BASE}/messengers/apps?pair=${encodeURIComponent(CHANNEL)}&state=${encodeURIComponent(stateToken)}`;
}

function showPairing(note = '') {
  if (!state.pairingState) state.pairingState = crypto.randomBytes(24).toString('base64url');
  const win = state.pairWin || new BrowserWindow({
    width: 640, height: 700, resizable: false, title: APP_NAME, backgroundColor: '#f5f7fa', show: false,
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      preload: path.join(__dirname, 'preload-pair.js'),
      partition: 'pairing',
    },
  });
  if (!state.pairWin) {
    state.pairWin = win;
    win.once('ready-to-show', () => win.show());
    if (SELFTEST) {
      win.webContents.once('did-finish-load', async () => {
        await new Promise((r) => setTimeout(r, 1200));
        if (SHOT) fs.writeFileSync(SHOT, (await win.webContents.capturePage()).toPNG());
        const text = await win.webContents.executeJavaScript('document.body.innerText.slice(0, 200)', true).catch(() => '');
        console.log(JSON.stringify({ ok: true, stage: 'pairing', title: win.getTitle(), text }));
        app.exit(0);
      });
    }
    // Closing the pairing window after a successful connection must not quit
    // the program: the desk window is about to open.
    win.on('closed', () => { state.pairWin = null; if (!state.win && !state.device && !state.booting) app.quit(); });
  }
  win.loadFile(path.join(__dirname, 'pair.html'), {
    query: { app: APP_NAME, channel: CHANNEL, note, url: pairPageUrl(state.pairingState) },
  });
}

async function completePairing(code, stateToken) {
  // The apps page hands the code back through the app link; the code is a
  // one-time secret bound to the window token on the server.
  if (!code || !stateToken || !/^[A-Za-z0-9_-]{16,128}$/.test(stateToken)) {
    return { ok: false, error: 'This link is incomplete. Open the apps page and connect again.' };
  }
  let r;
  try {
    r = await platformRequest('POST', '/api/messenger-apps/pair', {
      body: { code, state: stateToken, deviceLabel: os.hostname(), appVersion: APP_VERSION },
    });
  } catch (err) {
    return { ok: false, error: 'The platform did not answer. Check the internet and try again.' };
  }
  if (r.status !== 200 || !r.json || !r.json.token) {
    return { ok: false, error: (r.json && r.json.error) || 'The code was not accepted.' };
  }
  writeJson(DEVICE_FILE, { token: r.json.token, deviceId: r.json.device.id, app: r.json.app, pairedAt: new Date().toISOString() });
  state.device = loadDevice();
  state.pairingState = null;
  state.me = null;
  // Boot first, then close the pairing window: the program must never be windowless and idle.
  boot().catch((err) => showError(`Could not start: ${err.message}`));
  if (state.pairWin) { const w = state.pairWin; state.pairWin = null; w.destroy(); }
  return { ok: true };
}

function handleOpenUrl(url) {
  let u;
  try { u = new URL(url); } catch (_) { return; }
  if (u.protocol.replace(':', '') !== SCHEME) return;
  if (u.hostname === 'open') { const w = state.win || state.pairWin; if (w) w.show(); return; }
  if (u.hostname !== 'pair') return;
  // The link can arrive before the program is ready (it launched the program).
  app.whenReady().then(() => completePairing(u.searchParams.get('code') || '', u.searchParams.get('state') || ''))
    .then((res) => { if (!res.ok) showPairing(res.error); })
    .catch((err) => showPairing(err.message));
}

async function clearPlatformSession() {
  try { await platformSession().clearStorageData(); } catch (_) { /* noop */ }
}

function stopTimers() {
  for (const t of state.timers) clearInterval(t);
  state.timers = [];
}

function forgetAndPair(note) {
  try { fs.rmSync(DEVICE_FILE, { force: true }); } catch (_) { /* noop */ }
  stopTimers();
  clearPlatformSession();
  state.device = null;
  state.me = null;
  state.people = [];
  if (app.dock) app.dock.setBadge('');
  if (state.win && !state.win.isDestroyed()) { state.booting = true; state.win.destroy(); state.booting = false; }
  showPairing(note);
}

async function forgetDevice() {
  const { response } = await dialog.showMessageBox({
    type: 'question', buttons: ['Disconnect', 'Cancel'], defaultId: 1, cancelId: 1,
    message: `Disconnect ${APP_NAME} on this Mac?`,
    detail: 'The chats stay on the platform. To use the program again, allow this Mac on the apps page.',
  });
  if (response !== 0) return;
  try { fs.rmSync(DEVICE_FILE, { force: true }); } catch (_) { /* noop */ }
  await clearPlatformSession();
  app.relaunch();
  app.exit(0);
}

ipcMain.handle('pair:open', async () => {
  if (!state.pairingState) state.pairingState = crypto.randomBytes(24).toString('base64url');
  await shell.openExternal(pairPageUrl(state.pairingState));
  return { ok: true };
});
ipcMain.handle('pair:submit', async (_e, payload) => {
  const raw = String((payload && payload.code) || '').trim();
  // The page hands the code as "<code>.<state>" so a pasted code binds to the window that asked.
  const [code, stateToken] = raw.includes('.') ? raw.split('.') : [raw, state.pairingState || ''];
  return completePairing(code, stateToken);
});

// ---------------------------------------------------------------------------
// Updates: the program downloads its newest signed build, checks the
// signature, and replaces itself on restart (Arthur 2026-09-26: the program updates itself).

function versionNewer(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

function appBundlePath() {
  // …/WhatsApp SVIC.app/Contents/MacOS/WhatsApp SVIC → …/WhatsApp SVIC.app
  return path.resolve(path.dirname(process.execPath), '..', '..');
}

function download(url, file, redirects = 0, withDevice = true) {
  return new Promise((resolve, reject) => {
    const u = new URL(url, `${PLATFORM_BASE}/`);
    const headers = { 'User-Agent': `${APP_NAME}/${APP_VERSION}` };
    if (withDevice && state.device) headers['x-desk-device'] = state.device.token;
    const req = (u.protocol === 'https:' ? https : http).get(u, { headers, timeout: 60000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume();
        // The signed address of the build carries its own proof: no device key leaves the platform.
        return resolve(download(new URL(res.headers.location, u).toString(), file, redirects + 1, false));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`download ${res.statusCode}`)); }
      const out = fs.createWriteStream(file);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(file)));
      out.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('download timeout')); });
  });
}

async function teamId(appPath) {
  const out = await new Promise((resolve) => {
    execFile('/usr/bin/codesign', ['-dv', '--verbose=2', appPath], (err, stdout, stderr) => resolve(`${stdout}${stderr}`));
  });
  const m = /TeamIdentifier=(\S+)/.exec(out);
  return m && m[1] !== 'not' ? m[1] : null;
}

async function prepareUpdate(update) {
  const dir = path.join(USER_DATA, 'updates');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const dmg = await download(update.downloadPath, path.join(dir, update.file || 'update.dmg'));
  const mount = path.join(dir, 'mnt');
  fs.mkdirSync(mount, { recursive: true });
  await run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, dmg]);
  try {
    const src = path.join(mount, `${APP_NAME}.app`);
    if (!fs.existsSync(src)) throw new Error('the update has no program inside');
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', src]);
    const [mine, theirs] = await Promise.all([teamId(appBundlePath()), teamId(src)]);
    if (!theirs || (mine && mine !== theirs)) throw new Error('the update is not signed by SVIC');
    const staged = path.join(dir, `${APP_NAME}.app`);
    await run('/usr/bin/ditto', [src, staged]);
    return staged;
  } finally {
    await run('/usr/bin/hdiutil', ['detach', mount, '-force']).catch(() => {});
    fs.rmSync(dmg, { force: true });
  }
}

function installAndRelaunch(staged) {
  const target = appBundlePath();
  const script = [
    `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done`,
    `rm -rf "${target}.old"`,
    `mv "${target}" "${target}.old" && /usr/bin/ditto "${staged}" "${target}" && rm -rf "${target}.old" || { rm -rf "${target}"; mv "${target}.old" "${target}"; }`,
    `rm -rf "${staged}"`,
    `/usr/bin/open "${target}"`,
  ].join('\n');
  const child = spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore' });
  child.unref();
  state.quitting = true;
  app.quit();
}

function canSelfUpdate() {
  if (process.defaultApp) return false;
  const target = appBundlePath();
  if (!target.endsWith('.app') || target.startsWith('/Volumes/')) return false;
  try { fs.accessSync(path.dirname(target), fs.constants.W_OK); fs.accessSync(target, fs.constants.W_OK); return true; } catch (_) { return false; }
}

async function checkForUpdates(fromMenu = false) {
  let me = null;
  try { const r = await platformRequest('GET', '/api/messenger-apps/me'); me = r.json; } catch (_) { me = null; }
  const update = me && me.update;
  if (!update || !versionNewer(update.version, APP_VERSION)) {
    if (fromMenu) await dialog.showMessageBox({ type: 'info', buttons: ['OK'], message: `${APP_NAME} ${APP_VERSION} is up to date.` });
    return;
  }
  if (!canSelfUpdate()) {
    if (!fromMenu && readJson(PREFS_FILE, {}).updateSeen === update.version) return;
    writeJson(PREFS_FILE, { ...readJson(PREFS_FILE, {}), updateSeen: update.version });
    const { response } = await dialog.showMessageBox({
      type: 'info', buttons: ['Download', 'Later'], defaultId: 0, cancelId: 1,
      message: `${APP_NAME} ${update.version} is available.`,
      detail: `You have ${APP_VERSION}. Move ${APP_NAME} into Applications so it can update itself; for now the download opens in your browser.`,
    });
    if (response === 0) shell.openExternal(`${PLATFORM_BASE}/messengers/apps/${CHANNEL}/download`);
    return;
  }
  try {
    if (!state.updateReady || state.updateReady.version !== update.version) {
      state.updateReady = { version: update.version, staged: await prepareUpdate(update) };
    }
  } catch (err) {
    if (fromMenu) await dialog.showMessageBox({ type: 'warning', buttons: ['OK'], message: 'The update could not be downloaded.', detail: err.message });
    return;
  }
  const { response } = await dialog.showMessageBox({
    type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1,
    message: `${APP_NAME} ${update.version} is ready.`,
    detail: `You have ${APP_VERSION}. The program restarts in a few seconds; the chats stay on the platform.`,
  });
  if (response === 0) installAndRelaunch(state.updateReady.staged);
}

// ---------------------------------------------------------------------------
// Self-test

function within(ms, promise, fallback) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);
}

async function selftest() {
  const wc = state.win && state.win.webContents;
  if (wc && wc.isLoading()) await within(30000, new Promise((r) => wc.once('did-finish-load', r)), null);
  await new Promise((r) => setTimeout(r, 25000));
  const probe = `(function(){
    var rows = document.querySelectorAll('#conversationList .md-conversation, #conversationList [data-id]').length;
    var live = document.getElementById('waConsoleRoot');
    var frame = document.querySelector('#wacHost iframe');
    var doc = frame && frame.contentDocument;
    var stats = window.SvicWaConsole && window.SvicWaConsole.stats;
    return JSON.stringify({ text: doc && doc.body ? doc.body.innerText.slice(0, 240) : document.body.innerText.slice(0, 240), rows: rows,
      app: document.documentElement.classList.contains('md-app'),
      console: !!(live && !live.hidden && frame),
      painted: !!(stats && stats.snapshots > 0),
      stats: stats || null,
      layout: (function () {
        var r = live ? live.getBoundingClientRect() : null;
        var f = frame ? frame.getBoundingClientRect() : null;
        var w = document.querySelector('#wacHost .replayer-wrapper');
        return { root: r ? [r.width, r.height, getComputedStyle(live).display, live.parentElement.tagName] : null,
          frame: f ? [f.width, f.height, frame.width, frame.height] : null,
          scale: w ? w.style.transform : null, cls: document.documentElement.className };
      })(),
      title: document.title,
      topbar: !!(document.querySelector('.topbar') && document.querySelector('.topbar').offsetHeight) });
  })()`;
  const page = wc ? await within(5000, wc.executeJavaScript(probe, true).then(JSON.parse).catch((e) => ({ error: e.message })), { error: 'timeout' }) : {};
  if (SHOT && wc) { const img = await within(5000, wc.capturePage().catch(() => null), null); if (img) fs.writeFileSync(SHOT, img.toPNG()); }
  console.log(JSON.stringify({
    ok: !!(wc && isDeskUrl(wc.getURL()) && page.console && !page.topbar),
    user: state.me && state.me.user,
    people: state.people.map((x) => ({ key: x.key, name: x.name })),
    current: state.current,
    unread: state.unread,
    url: wc ? wc.getURL() : null,
    title: state.win ? state.win.getTitle() : null,
    menu: (Menu.getApplicationMenu().items.find((i) => i.label === 'Edit') || { submenu: { items: [] } }).submenu.items.map((i) => i.label).filter(Boolean),
    page,
  }));
  app.exit(0);
}

// ---------------------------------------------------------------------------
// Boot

// Boots run one after another: a launch through the pairing link fires the
// link and the first start at the same moment, and two parallel boots would
// open two windows.
let bootChain = Promise.resolve();
function boot() {
  // Marked at once, not inside the chain: closing the pairing window right
  // before a boot fires window-all-closed, and an unmarked gap quit the
  // program after its first connection (2026-09-26, live check of 2.0.0).
  state.booting = true;
  bootChain = bootChain.then(async () => {
    state.booting = true;
    try { await bootInner(); } finally { state.booting = false; }
  });
  return bootChain;
}

async function bootInner() {
  state.device = loadDevice();
  // Already running with this key: nothing to start twice.
  if (state.device && state.me && state.win && !state.win.isDestroyed()) return;
  buildMenu();
  retireLocalMessengerSignIns();
  if (!state.device) return showPairing();

  let me;
  try {
    const r = await platformRequest('GET', '/api/messenger-apps/me');
    if (r.status === 401) return forgetAndPair('This Mac was disconnected on the apps page. Connect it again to continue.');
    if (r.status !== 200 || !r.json) throw new Error(`platform ${r.status}`);
    me = r.json;
  } catch (err) {
    return showError('The platform did not answer. Check the internet and open the program again.');
  }
  state.me = me;
  state.people = (me.people || []).filter((e) => PEOPLE_ORDER.includes(e.key))
    .sort((a, b) => PEOPLE_ORDER.indexOf(a.key) - PEOPLE_ORDER.indexOf(b.key))
    .map((e) => ({ key: e.key, name: e.name }));
  if (!state.people.length) return showError(`No messenger desk of yours can be opened in ${APP_NAME}. Ask Arthur to open your desk.`);

  try {
    await signInWeb();
  } catch (err) {
    if (err.code === 'unpaired') return forgetAndPair('This Mac was disconnected on the apps page. Connect it again to continue.');
    return showError('The platform did not let the program in. Check the internet and open the program again.');
  }

  if (!state.win || state.win.isDestroyed()) createWindow();
  const prefs = readJson(PREFS_FILE, {});
  const first = (SELFTEST_PERSON && person(SELFTEST_PERSON) ? SELFTEST_PERSON : null)
    || (person(prefs.person) ? prefs.person : state.people[0].key);
  selectPerson(first);

  stopTimers();
  await pollUnread();
  state.timers.push(setInterval(pollUnread, UNREAD_MS));
  heartbeat();
  state.timers.push(setInterval(heartbeat, HEARTBEAT_MS));
  state.timers.push(setInterval(() => { signInWeb().catch(() => {}); }, SESSION_REFRESH_MS));
  if (!SELFTEST) {
    setTimeout(() => checkForUpdates(false), 20000);
    state.timers.push(setInterval(() => checkForUpdates(false), UPDATE_CHECK_MS));
  }
  if (SELFTEST) selftest();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // A self-test run must never take the program's link over: on 2026-09-26 a
  // development run became the handler of svic-wa:// and the installed
  // WhatsApp SVIC stopped receiving its pairing link.
  if (SCHEME && !TEST_PROFILE && !SELFTEST) {
    if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]);
    else app.setAsDefaultProtocolClient(SCHEME);
  }
  app.on('open-url', (event, url) => { event.preventDefault(); handleOpenUrl(url); });
  app.on('second-instance', (_e, argv) => {
    const deep = (argv || []).find((a) => a.startsWith(`${SCHEME}://`));
    if (deep) handleOpenUrl(deep);
    const w = state.win || state.pairWin;
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
  // Closing the window keeps the program in the Dock (badge and notifications
  // go on); clicking the Dock icon opens the desk again.
  app.on('activate', () => {
    if (state.pairWin) return state.pairWin.show();
    if (state.win && !state.win.isDestroyed()) return state.win.show();
    if (state.device && state.people.length) { createWindow(); selectPerson(state.current || state.people[0].key); return; }
    // The start failed and its error window was closed: start again.
    state.me = null;
    boot().catch((err) => showError(`Could not start: ${err.message}`));
  });
  app.on('window-all-closed', () => { if (!state.device && !state.booting) app.quit(); });
  app.whenReady().then(boot).catch((err) => showError(`Could not start: ${err.message}`));
}
