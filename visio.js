/* Render-verify the 36-point plan: before / after / tour × desktop 1440 + mobile 390. */
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  fs.mkdirSync('out', { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const variants = [
    ['before', '/'],
    ['after', '/?__plan=1'],
    ['tour', '/?__plan=tour'],
  ];
  for (const [vname, path] of variants) {
    for (const [name, vp, mob] of [['desktop', { width: 1440, height: 900 }, false], ['mobile', { width: 390, height: 844 }, true]]) {
      const ctx = await browser.newContext({ viewport: vp, isMobile: mob, hasTouch: mob, deviceScaleFactor: 2 });
      await ctx.addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test3.siliconvalleyinvestclub.com', path: '/' }]);
      const page = await ctx.newPage();
      const errs = [];
      page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
      await page.goto('https://test3.siliconvalleyinvestclub.com' + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(8000);
      await page.screenshot({ path: `out/${vname}-${name}-fold.png` });
      await page.screenshot({ path: `out/${vname}-${name}-full.png`, fullPage: true });
      console.log(`${vname}-${name}: console-errors=${errs.length}${errs.length ? ' :: ' + errs.slice(0, 4).join(' | ') : ''}`);
      await ctx.close();
    }
  }
  await browser.close();
  console.log('CAPTURED');
})().catch(e => { console.error(e); process.exit(1); });
