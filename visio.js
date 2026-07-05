/* iOS 26.5.2 Chrome emulator (Playwright WebKit). Verifies: on touch the cover clips are
   REMOVED (posters shown) — zero videos, so nothing can loop/stall; and the poster renders. */
const { webkit } = require('playwright');
const fs = require('fs');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.0 Mobile/15E148 Safari/604.1';
(async () => {
  fs.mkdirSync('out', { recursive: true });
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await ctx.addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test3.siliconvalleyinvestclub.com', path: '/' }]);
  const page = await ctx.newPage();
  await page.goto('https://test3.siliconvalleyinvestclub.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);
  await page.touchscreen.tap(196, 300);
  // sample video count over 10s — with the fix it must fall to 0 and stay there
  const counts = [];
  for (let i = 0; i < 20; i++) { counts.push(await page.evaluate(() => document.querySelectorAll('video').length)); await page.waitForTimeout(500); }
  const posterVisible = await page.evaluate(() => {
    const bg = document.querySelector('.cs-overlay-background img');
    if (!bg) return { hasPoster: false };
    const r = bg.getBoundingClientRect();
    return { hasPoster: true, w: Math.round(r.width), h: Math.round(r.height), complete: bg.complete, src: (bg.currentSrc || bg.src).slice(-50) };
  });
  await page.screenshot({ path: 'out/ios-poster.png' });
  fs.writeFileSync('out/report.json', JSON.stringify({ counts, posterVisible }, null, 2));
  await browser.close();
  console.log('VIDEO_COUNTS:', counts.join(' '));
  console.log('POSTER:', JSON.stringify(posterVisible));
})().catch(e => { console.error(e); process.exit(1); });
