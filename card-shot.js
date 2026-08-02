// card-shot.js — скрины карточки компании стенда: desktop-верх, полная, mobile.
// Запасной облачный визиотестер: когда CF Browser Rendering в дневном лимите.
const { chromium } = require('playwright');
(async () => {
  const url = process.env.SHOT_URL || 'https://test.siliconvalleyinvestclub.com/corgi-insurance/test?__static=1';
  const fs = require('fs'); fs.mkdirSync('out', { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000); // settle-пауза: дожёвывающие DOM скрипты
  await page.screenshot({ path: 'out/card-desktop-top.png' });
  await page.screenshot({ path: 'out/card-full.png', fullPage: true });
  const mob = await ctx.newPage(); await mob.setViewportSize({ width: 390, height: 844 });
  await mob.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await mob.waitForTimeout(3000);
  await mob.screenshot({ path: 'out/card-mobile.png', fullPage: true });
  await browser.close();
  console.log('shots done');
})().catch((e) => { console.error(e); process.exit(1); });
