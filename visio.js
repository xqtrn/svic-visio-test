/* Fresh full-page captures of the CURRENT home: desktop 1440 + mobile 390 (+ fold crops). */
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  fs.mkdirSync('out', { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  for (const [name, vp, mob] of [['desktop', { width: 1440, height: 900 }, false], ['mobile', { width: 390, height: 844 }, true]]) {
    const ctx = await browser.newContext({ viewport: vp, isMobile: mob, hasTouch: mob, deviceScaleFactor: 2 });
    await ctx.addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test3.siliconvalleyinvestclub.com', path: '/' }]);
    const page = await ctx.newPage();
    await page.goto('https://test3.siliconvalleyinvestclub.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);
    await page.screenshot({ path: `out/${name}-fold.png` });
    await page.screenshot({ path: `out/${name}-full.png`, fullPage: true });
    await ctx.close();
  }
  await browser.close();
  console.log('CAPTURED');
})().catch(e => { console.error(e); process.exit(1); });
