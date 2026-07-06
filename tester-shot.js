const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test3.siliconvalleyinvestclub.com', path: '/' }]);
  const pg = await ctx.newPage();
  await pg.goto('https://test3.siliconvalleyinvestclub.com/__faces', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(6000);
  require('fs').mkdirSync('out', { recursive: true });
  await pg.screenshot({ path: 'out/faces-tester.png' });
  console.log('CAPTURED cards=' + await pg.locator('.card').count());
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
