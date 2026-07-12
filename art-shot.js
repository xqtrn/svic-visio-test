const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })).newPage();
  await pg.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  await pg.goto('https://test.siliconvalleyinvestclub.com/2026/07/09/sambanova-raises-1-billion-at-an-11-billion-valuation/?z=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(8000);
  await pg.evaluate(() => { const e = document.querySelector('.entry-content a.profile-btn'); if (e) e.scrollIntoView({ block: 'center' }); });
  await pg.waitForTimeout(1200);
  await pg.screenshot({ path: 'out/ending.png' });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
