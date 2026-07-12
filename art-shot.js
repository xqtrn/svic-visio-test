const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
  await pg.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  await pg.goto('https://test.siliconvalleyinvestclub.com/2026/07/09/sambanova-raises-1-billion-at-an-11-billion-valuation/?z=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(9000);
  console.log('META', await pg.evaluate(() => JSON.stringify((document.querySelector('.svic-meta') || {}).innerText || null)));
  const r = await pg.evaluate(() => { const m = document.querySelector('.svic-arthead'); const b2 = m.getBoundingClientRect(); return { x: b2.x, y: Math.max(0, b2.y - 4), w: b2.width, h: b2.height + 8 }; });
  await pg.screenshot({ path: 'out/meta.png', clip: { x: r.x, y: r.y, width: Math.min(r.w, 1440), height: Math.min(r.h, 400) } });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
