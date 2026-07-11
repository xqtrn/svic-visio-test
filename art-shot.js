const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const A = 'https://test.siliconvalleyinvestclub.com/2026/07/09/sambanova-raises-1-billion-at-an-11-billion-valuation/?z=';
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 2 })).newPage();
  await pg.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  await pg.goto(A + Date.now(), { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(9000);
  await pg.screenshot({ path: 'out/cv-top.png' });
  await pg.evaluate(() => scrollTo(0, 1800));
  await pg.waitForTimeout(1500);
  console.log('MINI', await pg.evaluate(() => {
    const h = document.querySelector('.cs-entry__media-wrap');
    const v = h ? h.querySelector('video') : null;
    const r = h.getBoundingClientRect();
    return JSON.stringify({ mini: h.classList.contains('svic-mini'), fixedRight: Math.round(innerWidth - r.right), fixedBottom: Math.round(innerHeight - r.bottom), w: Math.round(r.width), playing: v ? !v.paused : null, pipDisabled: v ? v.disablePictureInPicture : null });
  }));
  await pg.screenshot({ path: 'out/cv-mini.png' });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
