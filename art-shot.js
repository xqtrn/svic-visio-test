const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })).newPage();
  await pg.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  await pg.goto('https://test.siliconvalleyinvestclub.com/2026/07/09/sambanova-raises-1-billion-at-an-11-billion-valuation/?z=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(9000);
  // хвост статьи: тег, prev/next, related
  await pg.evaluate(() => { const e = document.querySelector('.cs-entry__tags'); if (e) e.scrollIntoView({ block: 'start' }); });
  await pg.waitForTimeout(1600);
  await pg.screenshot({ path: 'out/tail-blocks.png' });
  // мини-плеер: замер полос
  console.log('MINI', await pg.evaluate(() => {
    const h = document.querySelector('.cs-entry__media-wrap');
    const v = h ? h.querySelector('video') : null;
    if (!h || !v) return '{}';
    const hb = h.getBoundingClientRect(), vb = v.getBoundingClientRect();
    const va = v.videoWidth / v.videoHeight, ba = vb.width / vb.height;
    const renderW = ba > va ? vb.height * va : vb.width;
    const sideBar = (vb.width - renderW) / 2;
    return JSON.stringify({ mini: h.classList.contains('svic-mini'), hostW: +hb.width.toFixed(1), hostH: +hb.height.toFixed(1), hostAspect: +(hb.width / hb.height).toFixed(4), vidWH: v.videoWidth + 'x' + v.videoHeight, sideBarPx: +sideBar.toFixed(2) });
  }));
  await pg.screenshot({ path: 'out/mini-zoom.png', clip: { x: 990, y: 720, width: 450, height: 280 } });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
