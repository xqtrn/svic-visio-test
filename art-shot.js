const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
  await pg.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  await pg.goto('https://test.siliconvalleyinvestclub.com/2026/07/09/sambanova-raises-1-billion-at-an-11-billion-valuation/?z=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(8000);
  const info = await pg.evaluate(() => {
    const tds = [...document.querySelectorAll('.entry-content td')];
    const band = tds.find(td => td.querySelector('img') && td.getAttribute('colspan'));
    if (!band) return '{}';
    const a = band.querySelector('a');
    const el = a ? (a.querySelector('*') || a) : band;
    band.scrollIntoView({ block: 'center' });
    return JSON.stringify({ color: getComputedStyle(el).color, bg: getComputedStyle(band).backgroundColor });
  });
  console.log('BAND', info);
  await pg.waitForTimeout(900);
  const r = await pg.evaluate(() => { const b2 = [...document.querySelectorAll('.entry-content td')].find(td => td.querySelector('img') && td.getAttribute('colspan')); const x = b2.getBoundingClientRect(); return { x: x.x, y: x.y, w: x.width, h: x.height }; });
  await pg.screenshot({ path: 'out/band.png', clip: { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: Math.min(r.w + 16, 1440), height: Math.min(r.h + 760, 980) } });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
