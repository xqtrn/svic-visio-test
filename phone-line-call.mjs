// An associate's phone line, live: a QA TEST CANDIDATE signs in by his test link, takes the
// Voice token of his own desk (the same API the web desk and the iOS app use), places one
// outgoing call to DIAL_TO and then answers one incoming call to his line.
// The microphone is a recorded voice (phone-line/assoc.wav). Never dials a person: DIAL_TO
// must be one of our own pool numbers (the workflow checks the area code and the run input).
import { chromium } from 'playwright';
import fs from 'fs';

const WELCOME = (process.env.AJ_WELCOME || '').trim();
const DIAL_TO = (process.env.DIAL_TO || '').trim();
const TALK_MS = Number(process.env.TALK_SECONDS || 45) * 1000;
const WAIT_INCOMING_MS = Number(process.env.WAIT_INCOMING_SECONDS || 300) * 1000;
const BASE = 'https://platform.siliconvalleyinvestclub.com';
const OUT = 'out';
fs.mkdirSync(OUT, { recursive: true });
const report = { steps: [], errors: [], events: [] };
const log = (m, extra) => { const e = { t: new Date().toISOString(), m, ...(extra || {}) }; report.events.push(e); console.log('[line]', JSON.stringify(e)); };
if (!WELCOME) throw new Error('AJ_WELCOME is empty');
if (!/^\+1650\d{7}$/.test(DIAL_TO)) throw new Error('DIAL_TO must be one of our +1650 pool numbers');

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${process.cwd()}/phone-line/assoc.wav`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, permissions: ['microphone'] });
const page = await ctx.newPage();
page.on('console', (msg) => { const t = msg.text(); if (/\[voice\]/.test(t)) console.log(t); });

try {
  await page.goto(WELCOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#btnTestSignIn', { timeout: 30000 });
  await Promise.all([page.waitForURL((u) => u.host === 'platform.siliconvalleyinvestclub.com', { timeout: 60000 }), page.click('#btnTestSignIn')]);
  log('signed in as the test candidate', { url: new URL(page.url()).pathname });

  // A same-origin, secure page of our own for the call (no platform CSP in the way, our cookies).
  await page.route(`${BASE}/__phone_line_test`, (route) => route.fulfill({
    status: 200, contentType: 'text/html',
    body: '<!doctype html><meta charset="utf-8"><title>line test</title><script src="https://unpkg.com/@twilio/voice-sdk@2.12.1/dist/twilio.min.js"></script><p id="s">ready</p>',
  }));
  await page.goto(`${BASE}/__phone_line_test`, { waitUntil: 'load', timeout: 60000 });

  const me = await page.evaluate(async () => {
    const line = await (await fetch('/api/phone-pool/my-line', { credentials: 'include' })).json();
    const desk = line && line.line && line.line.deskKey;
    const tok = desk ? await (await fetch(`/api/messengers/voice/token?person=${encodeURIComponent(desk)}`, { credentials: 'include' })).json() : null;
    return { line: line && line.line, identity: tok && tok.identity, outboundEnabled: tok && tok.outboundEnabled, recording: tok && tok.recording, hasToken: !!(tok && tok.token), tokenError: tok && tok.error };
  });
  report.line = me;
  log('my line', me);
  if (!me.line || !me.hasToken) throw new Error('no line or no voice token: ' + JSON.stringify(me));

  const out = await page.evaluate(async ({ to, talkMs, waitMs }) => {
    const events = [];
    const ev = (m) => { events.push({ t: Date.now(), m }); console.log('[voice] ' + m); };
    const desk = (await (await fetch('/api/phone-pool/my-line', { credentials: 'include' })).json()).line.deskKey;
    const getToken = async () => (await (await fetch(`/api/messengers/voice/token?person=${encodeURIComponent(desk)}`, { credentials: 'include' })).json()).token;
    const device = new window.Twilio.Device(await getToken(), { logLevel: 'warn', closeProtection: false });
    device.on('error', (e) => ev('device error ' + (e && (e.code + ' ' + e.message))));
    device.on('tokenWillExpire', async () => device.updateToken(await getToken()));
    await device.register();
    ev('registered');
    const result = { outgoing: null, incoming: null, events };
    // 1. Outgoing call from the line.
    const call = await device.connect({ params: { To: to } });
    result.outgoing = await new Promise((resolve) => {
      let accepted = false;
      const timer = setTimeout(() => { ev('outgoing: no answer in 60s'); try { call.disconnect(); } catch (_) {} resolve({ accepted, sid: call.parameters && call.parameters.CallSid }); }, 60000);
      call.on('accept', () => { accepted = true; clearTimeout(timer); ev('outgoing accepted ' + (call.parameters && call.parameters.CallSid)); setTimeout(() => call.disconnect(), talkMs); });
      call.on('disconnect', () => { clearTimeout(timer); ev('outgoing disconnected'); resolve({ accepted, sid: call.parameters && call.parameters.CallSid }); });
      call.on('error', (e) => ev('outgoing error ' + (e && (e.code + ' ' + e.message))));
    });
    // 2. Incoming call to the line: answer it.
    ev('waiting for an incoming call');
    result.incoming = await new Promise((resolve) => {
      const timer = setTimeout(() => { ev('no incoming call'); resolve({ accepted: false }); }, waitMs);
      device.on('incoming', (c) => {
        ev('incoming from ' + (c.parameters && c.parameters.From));
        c.on('accept', () => { ev('incoming accepted ' + (c.parameters && c.parameters.CallSid)); setTimeout(() => c.disconnect(), talkMs); });
        c.on('disconnect', () => { clearTimeout(timer); ev('incoming disconnected'); resolve({ accepted: true, from: c.parameters && c.parameters.From, sid: c.parameters && c.parameters.CallSid }); });
        c.accept();
      });
    });
    device.destroy();
    return result;
  }, { to: DIAL_TO, talkMs: TALK_MS, waitMs: WAIT_INCOMING_MS });
  report.result = out;
  log('done', { outgoing: out.outgoing, incoming: out.incoming });
  if (!out.outgoing || !out.outgoing.accepted) report.errors.push({ step: 'outgoing', error: 'not accepted' });
  if (!out.incoming || !out.incoming.accepted) report.errors.push({ step: 'incoming', error: 'not accepted' });
} catch (e) {
  report.fatal = String(e).slice(0, 1500);
  console.log('[fatal]', report.fatal);
} finally {
  await page.screenshot({ path: `${OUT}/last.png` }).catch(() => {});
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
if (report.fatal || report.errors.length) process.exit(1);
