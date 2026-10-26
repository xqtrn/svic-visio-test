// esign-content.mjs — E-Signature «Document» on a sent document's page (platform,
// 2026-10-26, Daria: «при нажатии на документ, который я когда-либо отправляла,
// посмотреть содержимое»). The branch page comes from overrides/esign; the
// platform's shared files (app.css, fonts, loader, ui.js, pdf.js) are the live
// ones; every /api answer is a fixed sample — nothing reaches the platform's data.
// Scenarios: a sent NCNDA not yet signed («As sent …») and a completed one
// («Signed copy»), each opened from its address, plus «Open in a new tab».
// Env: ENGINE (webkit = iPhone 393 | chromium = desktop 1440).
import { webkit, chromium } from 'playwright';
import fs from 'fs';

const ENGINE = process.env.ENGINE === 'webkit' ? 'webkit' : 'chromium';
const OUT = 'out';
const DIR = 'overrides/esign';
fs.mkdirSync(OUT, { recursive: true });
const PROBE = fs.readFileSync('overrides/ds-spacing-probe.browser.js', 'utf8');
const profile = ENGINE === 'webkit'
  ? { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }
  : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25 };
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const ctx = await browser.newContext({ ...profile, locale: 'en-US' });
const report = { engine: ENGINE, steps: [], errors: [], contentHits: [] };
const PLATFORM = 'platform.siliconvalleyinvestclub.com';
const PDF = fs.readFileSync(`${DIR}/sent.pdf`);
const json = (o, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(o) });

const at = (d) => new Date(Date.UTC(2026, 9, d, 17, 20)).toISOString();
function envelope(pid, status) {
  const done = status === 'completed';
  return {
    envelope: { id: pid === 'qasent' ? 1 : 2, public_id: pid, title: 'NCNDA — Example Capital', document_type: 'ncnda', status,
      created_at: at(20), sent_at: at(20), completed_at: done ? at(22) : null, metadata: {}, workflow_column: done ? 'signed' : 'viewed',
      content_url: `/api/esign/${pid}/content` },
    documents: [{ id: 9, role: 'source', filename: 'NCNDA.pdf', page_count: 6 }],
    recipients: [
      { id: 1, name: 'Pat Partner', email: 'pat@example.com', role: 'signer', auth_method: 'email_otp', status: done ? 'signed' : 'viewed', signed_at: done ? at(21) : null, ip: done ? '203.0.113.7' : null },
      { id: 2, name: 'Siarhei Hlebko', email: 'serge@siliconvalleyinvestclub.com', role: 'signer', auth_method: 'none', status: done ? 'signed' : 'sent', signed_at: done ? at(22) : null, ip: null },
    ],
    fields: [],
    events: [
      { id: 1, event_type: 'created', actor: 'Daria', created_at: at(20) },
      { id: 2, event_type: 'sent', actor: 'Daria', created_at: at(20) },
      { id: 3, event_type: 'viewed', actor: 'pat@example.com', created_at: at(21) },
      ...(done ? [{ id: 4, event_type: 'signed', actor: 'pat@example.com', created_at: at(21) }, { id: 5, event_type: 'completed', actor: 'system', created_at: at(22) }] : []),
    ],
    attachments: [],
  };
}

await ctx.route((u) => u.hostname === PLATFORM, async (route, req) => {
  const p = new URL(req.url()).pathname;
  if (p === '/esign' || p === '/esign.html') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(`${DIR}/esign.html`) });
  if (p === '/api/nav') return route.fulfill(json({ menu: { pinned: [], groups: [] }, landing: '/' }));
  if (p === '/api/esign/me') return route.fulfill(json({ role: 'manager', name: 'Daria' }));
  const content = p.match(/^\/api\/esign\/(qasent|qadone)\/content$/);
  if (content) { report.contentHits.push(content[1]); return route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'content-disposition': 'inline; filename="sent.pdf"' }, body: PDF }); }
  if (p === '/api/esign/qasent') return route.fulfill(json(envelope('qasent', 'in_progress')));
  if (p === '/api/esign/qadone') return route.fulfill(json(envelope('qadone', 'completed')));
  if (p.startsWith('/api/')) return route.fulfill(json({ error: 'sample stand' }, 404));
  return route.fallback();
});

const page = await ctx.newPage();
page.on('pageerror', (e) => report.errors.push({ step: 'pageerror', url: page.url(), error: String(e).slice(0, 300) }));
page.on('console', (m) => { if (m.type() === 'error' && !/404|sample stand|Content Security Policy/.test(m.text())) report.errors.push({ step: 'console', url: page.url(), error: m.text().slice(0, 300) }); });
page.on('dialog', (d) => { report.errors.push({ step: 'native-dialog', error: d.message() }); d.dismiss().catch(() => {}); });
let n = 0;
async function shot(name, extra = {}) {
  n += 1;
  await page.waitForTimeout(900);
  const base = `${String(n).padStart(2, '0')}-${name}`;
  await page.screenshot({ path: `${OUT}/${base}.png` });
  await page.screenshot({ path: `${OUT}/${base}-full.png`, fullPage: true }).catch(() => {});
  const probe = await page.evaluate(() => ({ url: location.host + location.pathname + location.search, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })).catch(() => ({}));
  const spacing = await page.evaluate(PROBE).catch((e) => ({ error: String(e).slice(0, 120) }));
  const step = { n, name, file: `${base}.png`, ...probe, overflow: probe.scrollWidth > probe.innerWidth + 1, spacing, ...extra };
  report.steps.push(step);
  console.log('[shot]', JSON.stringify(step));
}
const docState = () => page.evaluate(() => {
  const box = document.getElementById('dDocBox'); const host = document.getElementById('dDoc');
  const cvs = [...host.querySelectorAll('canvas')]; const r = host.getBoundingClientRect();
  const open = document.getElementById('dDocOpen');
  return { visible: !!box && !box.hidden, note: document.getElementById('dDocNote').textContent, pages: cvs.length,
    firstPageWidth: cvs[0] ? Math.round(cvs[0].getBoundingClientRect().width) : 0, boxWidth: Math.round(r.width), boxLeft: Math.round(r.left),
    openHref: open && open.getAttribute('href'), status: (host.querySelector('.status') || {}).textContent || null,
    signersBelow: (() => { const s = document.getElementById('dRecips').getBoundingClientRect(); return s.top >= r.bottom; })() };
});

for (const [pid, label] of [['qasent', 'sent-not-signed'], ['qadone', 'signed']]) {
  await page.goto(`https://${PLATFORM}/esign?env=${pid}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#dDoc canvas').length >= 6 || /did not load/.test(document.getElementById('dDoc')?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
  const state = await docState();
  await shot(`${label}-top`, { doc: state });
  if (state.pages < 1) report.errors.push({ step: `${label}-no-pages`, state });
  if (pid === 'qasent' && !/As sent/.test(state.note)) report.errors.push({ step: 'sent-note', state });
  if (pid === 'qadone' && state.note !== 'Signed copy') report.errors.push({ step: 'signed-note', state });
  await page.locator('#dDoc').scrollIntoViewIfNeeded();
  await page.locator('#dDoc').evaluate((el) => { el.scrollTop = el.scrollHeight / 2; });
  await shot(`${label}-pages-scrolled`);
  await page.locator('#dRecips').scrollIntoViewIfNeeded();
  await shot(`${label}-signers-below`);
}

// «Open in a new tab» opens the same pages.
const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 10000 }).catch(() => null), page.click('#dDocOpen').catch(() => null)]);
if (popup) await popup.waitForURL(/\/content$/, { timeout: 15000 }).catch(() => {});
report.newTab = popup ? popup.url() : null;
// The new tab shows the PDF (its address is not always readable once a PDF viewer owns it):
// proof is the tab itself plus the third request to the content address.
if (!popup || report.contentHits.length !== 3 || report.contentHits[2] !== 'qadone') report.errors.push({ step: 'open-new-tab', url: report.newTab, hits: report.contentHits });

fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log('[report]', JSON.stringify({ engine: ENGINE, steps: report.steps.length, errors: report.errors, contentHits: report.contentHits, newTab: report.newTab }));
await browser.close();
if (report.errors.length) process.exit(1);
