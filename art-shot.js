const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
  for (const s of ['funds', 'trade-desk', 'research']) {
    await pg.goto('https://platform.siliconvalleyinvestclub.com/login/' + s + '?v=' + Date.now(), { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(3500);
    await pg.screenshot({ path: 'out/gate-' + s + '.png' });
  }
  const m = await (await b.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 3, isMobile: true })).newPage();
  await m.goto('https://platform.siliconvalleyinvestclub.com/login/brokers?v=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await m.waitForTimeout(3500);
  await m.screenshot({ path: 'out/gate-mobile.png' });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
