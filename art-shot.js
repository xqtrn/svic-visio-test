const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 })).newPage();
  await pg.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  await pg.goto('https://test.siliconvalleyinvestclub.com/tv?z=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(9000);
  console.log('TV', await pg.evaluate(() => {
    const v = document.getElementById('tvV');
    return JSON.stringify({ playing: v && !v.paused, src: v ? (v.currentSrc || '').split('/').pop() : null, now: (document.getElementById('tvNow') || {}).textContent, queue: document.querySelectorAll('#tvQ button').length });
  }));
  await pg.screenshot({ path: 'out/tv-page.png' });
  const m = await (await b.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })).newPage();
  await m.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  await m.goto('https://test.siliconvalleyinvestclub.com/tv?z=' + (Date.now() + 1), { waitUntil: 'domcontentloaded' });
  await m.waitForTimeout(8000);
  await m.screenshot({ path: 'out/tv-mobile.png' });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
