const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 })).newPage();
  await pg.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  await pg.goto('https://test.siliconvalleyinvestclub.com/interviews/?z=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(12000);
  console.log('IVID', await pg.evaluate(() => {
    const vids = [...document.querySelectorAll('.svic-sec-grid video')];
    return JSON.stringify({ mounted: vids.length, playing: vids.filter(v => !v.paused && v.readyState >= 2).length });
  }));
  await pg.screenshot({ path: 'out/intv2.png' });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
