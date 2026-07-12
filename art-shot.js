const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);

  const pg = await ctx.newPage();
  await pg.goto('https://test.siliconvalleyinvestclub.com/interviews/?z=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(12000);
  console.log('IVID', await pg.evaluate(() => {
    const all = [...document.querySelectorAll('video')];
    const live = all.filter(v => !v.classList.contains('svic-hv'));
    return JSON.stringify({
      liveMounted: live.length,
      livePlaying: live.filter(v => !v.paused && v.readyState >= 2).length,
      hoverPool: all.length - live.length,
      hoverVisible: all.filter(v => v.classList.contains('svic-hv') && v.classList.contains('on')).length
    });
  }));
  await pg.screenshot({ path: 'out/iv-top.png' });

  // ховер по второй карточке — видео должно включиться поверх фото
  const card = pg.locator('article.cs-entry').nth(1);
  await card.scrollIntoViewIfNeeded();
  await pg.waitForTimeout(800);
  const box = await card.locator('img').first().boundingBox();
  await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await pg.waitForTimeout(2500);
  console.log('HOVER', await pg.evaluate(() => {
    const on = [...document.querySelectorAll('video.svic-hv.on')];
    return JSON.stringify({ on: on.length, playing: on.filter(v => !v.paused && v.readyState >= 2).length });
  }));
  await pg.screenshot({ path: 'out/iv-hover.png' });

  // главная — для сравнения UX
  const pg2 = await ctx.newPage();
  await pg2.goto('https://test.siliconvalleyinvestclub.com/?z=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await pg2.waitForTimeout(10000);
  console.log('HOME', await pg2.evaluate(() => {
    const live = [...document.querySelectorAll('video')].filter(v => !v.classList.contains('svic-hv'));
    return JSON.stringify({ liveMounted: live.length, livePlaying: live.filter(v => !v.paused && v.readyState >= 2).length });
  }));
  await pg2.screenshot({ path: 'out/home-top.png' });

  const m = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  await m.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  await m.goto('https://test.siliconvalleyinvestclub.com/interviews/?z=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await m.waitForTimeout(9000);
  await m.screenshot({ path: 'out/iv-mobile.png' });
  console.log('MEX', await m.evaluate(() => {
    const ex = document.querySelector('.svic-sec-hero>article .cs-entry__excerpt');
    if (!ex) return 'none';
    const cs = getComputedStyle(ex), pr = ex.parentElement.getBoundingClientRect(), r = ex.getBoundingClientRect();
    return JSON.stringify({ w: r.width, pw: pr.width, vw: innerWidth, disp: cs.display, ws: cs.whiteSpace, mr: cs.marginRight, wid: cs.width });
  }));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
