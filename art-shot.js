const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const A = 'https://test.siliconvalleyinvestclub.com/2026/07/09/sambanova-raises-1-billion-at-an-11-billion-valuation/?z=';
  // desktop
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 })).newPage();
  await pg.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  await pg.goto(A + Date.now(), { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(9000);
  await pg.hover('.cs-entry__media-large').catch(()=>{});
  await pg.mouse.move(720, 300); await pg.waitForTimeout(600);
  console.log('GEO', await pg.evaluate(() => {
    const host = document.querySelector('.cs-entry__media-large .cs-entry__media-wrap');
    const v = host ? host.querySelector('video') : null;
    const r = host ? host.getBoundingClientRect() : null;
    return JSON.stringify({
      aspect: r ? +(r.width / r.height).toFixed(3) : null,
      fit: v ? getComputedStyle(v).objectFit : null,
      vidWH: v ? v.videoWidth + 'x' + v.videoHeight : null,
      loop: v ? v.loop : null,
      bar: !!document.querySelector('.svic-pl-bar'), prog: !!document.querySelector('.svic-pl-prog'),
      btns: document.querySelectorAll('.svic-pl-btn').length
    });
  }));
  await pg.screenshot({ path: 'out/pl-desktop.png' });
  await pg.close();
  // mobile
  const m = await (await b.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' })).newPage();
  await m.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  await m.goto(A + (Date.now()+1), { waitUntil: 'domcontentloaded' });
  await m.waitForTimeout(9000);
  await m.touchscreen.tap(195, 150); await m.waitForTimeout(500);
  console.log('MGEO', await m.evaluate(() => {
    const host = document.querySelector('.cs-entry__media-large .cs-entry__media-wrap');
    const r = host ? host.getBoundingClientRect() : null;
    return JSON.stringify({ aspect: r ? +(r.width / r.height).toFixed(3) : null, bar: !!document.querySelector('.svic-pl-bar') });
  }));
  await m.screenshot({ path: 'out/pl-mobile.png' });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
