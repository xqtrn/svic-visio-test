const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })).newPage();
  await pg.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  await pg.goto('https://test.siliconvalleyinvestclub.com/2026/07/09/sambanova-raises-1-billion-at-an-11-billion-valuation/?z=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(9000);
  const info = await pg.evaluate(() => {
    const v = document.querySelector('.cs-entry__media-large video, .cs-video-wrap video');
    if (!v) return { hasVideo: false };
    return { hasVideo: true, src: (v.currentSrc || v.src || '').slice(-60), readyState: v.readyState, w: v.videoWidth, h: v.videoHeight, paused: v.paused, curTime: +v.currentTime.toFixed(2) };
  });
  console.log('VIDEO', JSON.stringify(info));
  await pg.screenshot({ path: 'out/vid-hero.png' });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
