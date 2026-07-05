/* ui-audit.js — generic iOS-engine UI audit (Playwright WebKit + iPhone profile).
 * Dev-pipeline пост 5 (mobile): docs/DEV-PIPELINE.md in xqtrn/SVIC-Automation.
 * Inputs (env):
 *   BASE    — https://host (required)
 *   PATHS   — space-separated paths, default "/"
 *   COOKIES — "name=value;name2=value2" host-only cookies, optional
 * Outputs: out/<slug>-viewport.png, out/<slug>-full.png, out/report.json
 * Exit codes: 0 clean; 1 mobile defects found (horizontal overflow / pageerror);
 *             2 navigation failure. Reviewing agent still reads artifacts either way.
 */
const { webkit } = require('playwright');
const fs = require('fs');

const BASE = (process.env.BASE || '').replace(/\/$/, '');
if (!BASE) { console.error('BASE env required'); process.exit(2); }
const PATHS = (process.env.PATHS || '/').trim().split(/\s+/);
const COOKIES = (process.env.COOKIES || '').trim();
const host = new URL(BASE).hostname;

let step = 'init';
const bc = (x) => { step = x; console.log('[step]', x, new Date().toISOString()); };
setInterval(() => console.log('[hb]', step), 15000).unref();

(async () => {
  fs.mkdirSync('out', { recursive: true });
  bc('launch');
  const browser = await webkit.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  });
  if (COOKIES) {
    await ctx.addCookies(COOKIES.split(';').map(kv => {
      const [name, ...rest] = kv.trim().split('=');
      return { name, value: rest.join('='), domain: host, path: '/' };
    }));
  }

  const report = { base: BASE, engine: 'webkit-ios', viewport: '390x844@2', pages: [] };
  let worst = 0;

  for (const path of PATHS) {
    const slug = (path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root');
    const page = await ctx.newPage();
    const entry = { path, consoleErrors: [], pageErrors: [], defects: [] };
    page.on('console', m => { if (m.type() === 'error') entry.consoleErrors.push(m.text().slice(0, 200)); });
    page.on('pageerror', e => entry.pageErrors.push(String(e).slice(0, 200)));
    bc('goto ' + path);
    try {
      await page.goto(BASE + path, { waitUntil: 'commit', timeout: 60000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => entry.defects.push('dcl-timeout'));
      await page.waitForTimeout(4000);
      const probe = await page.evaluate(() => ({
        title: document.title.slice(0, 80),
        docHeight: document.documentElement.scrollHeight,
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body ? document.body.scrollWidth : 0,
      }));
      entry.probe = probe;
      // Горизонтальный скролл на мобильном = дефект (DEV-PIPELINE пост 5).
      if (Math.max(probe.scrollWidth, probe.bodyScrollWidth) > probe.innerWidth + 1) {
        entry.defects.push(`horizontal-overflow: content ${Math.max(probe.scrollWidth, probe.bodyScrollWidth)}px > viewport ${probe.innerWidth}px`);
      }
      bc('shoot ' + path);
      await page.screenshot({ path: `out/${slug}-viewport.png` });
      await page.screenshot({ path: `out/${slug}-full.png`, fullPage: true }).catch(e => entry.defects.push('fullpage-shot-failed: ' + String(e).slice(0, 100)));
    } catch (e) {
      entry.defects.push('navigation-failed: ' + String(e).slice(0, 200));
      worst = Math.max(worst, 2);
    }
    if (entry.pageErrors.length || entry.defects.some(d => d.startsWith('horizontal-overflow'))) worst = Math.max(worst, 1);
    entry.verdict = entry.defects.length || entry.pageErrors.length ? 'DEFECTS' : 'CLEAN';
    console.log(`[page] ${path} → ${entry.verdict}`, entry.defects.join(' | ') || '');
    report.pages.push(entry);
    await page.close();
  }

  fs.writeFileSync('out/report.json', JSON.stringify(report, null, 2));
  console.log('[done] pages:', report.pages.length, 'worst-exit:', worst);
  await browser.close();
  process.exit(worst);
})().catch(e => { console.error('[fatal]', e); process.exit(2); });
