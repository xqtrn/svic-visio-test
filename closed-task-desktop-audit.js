/* One-off cloud desktop smoke for authenticated Closed tasks session links. */
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = (process.env.BASE || '').replace(/\/$/, '');
const PATHS = (process.env.PATHS || '').trim().split(/\s+/).filter(Boolean);
const EXPECTED = (process.env.EXPECTED || '').trim().split(/\s+/).filter(Boolean);
const COOKIES = (process.env.COOKIES || '').trim();
const host = new URL(BASE).hostname;

(async () => {
  fs.mkdirSync('out-desktop', { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  if (COOKIES) {
    await ctx.addCookies(COOKIES.split(';').map((pair) => {
      const [name, ...rest] = pair.trim().split('=');
      return { name, value: rest.join('='), domain: host, path: '/' };
    }));
  }
  const report = { base: BASE, engine: 'chromium-desktop', viewport: '1440x1000', pages: [] };
  let failed = false;
  for (let index = 0; index < PATHS.length; index += 1) {
    const pagePath = PATHS[index];
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));
    await page.goto(BASE + pagePath, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    const probe = await page.evaluate(() => {
      const link = document.querySelector('.dt-work-session-link');
      return {
        title: document.title,
        url: location.href,
        href: link ? link.getAttribute('href') : null,
        text: link ? link.textContent.trim() : null,
        closed: Boolean(document.querySelector('.status-closed, [data-status="closed"], .pill-closed')),
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    const expected = EXPECTED[index] || null;
    const defects = [];
    if (probe.href !== expected) defects.push(`href ${probe.href} != ${expected}`);
    if (!probe.text || !probe.text.startsWith('Open work session in ')) defects.push('link text missing');
    if (probe.scrollWidth > probe.innerWidth + 1) defects.push('horizontal overflow');
    if (errors.length) defects.push('page error');
    failed ||= defects.length > 0;
    const slug = pagePath.match(/[0-9a-f-]{36}/i)?.[0] || `page-${index + 1}`;
    await page.screenshot({ path: `out-desktop/${slug}.png`, fullPage: true });
    report.pages.push({ path: pagePath, expected, probe, errors, defects, verdict: defects.length ? 'DEFECTS' : 'CLEAN' });
    await page.close();
  }
  fs.writeFileSync('out-desktop/report.json', JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(2); });
