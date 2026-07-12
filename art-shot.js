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
    const live = [...document.querySelectorAll('video')].filter(v => !v.classList.contains('svic-hv'));
    const plate = document.querySelector('.svic-sec-hero>article:first-child .cs-overlay-content .cs-entry__title');
    return JSON.stringify({ live: live.length, playing: live.filter(v => !v.paused && v.readyState >= 2).length,
      plate: plate ? getComputedStyle(plate.parentElement.parentElement).display : 'none',
      rails: document.querySelectorAll('.svic-sec-hero>article:nth-child(n+5)').length,
      moreHead: !!document.querySelector('.svic-sec-more') });
  }));
  await pg.screenshot({ path: 'out/iv-top.png' });
  const rail = pg.locator('article.cs-entry').nth(5);
  await rail.scrollIntoViewIfNeeded(); await pg.waitForTimeout(600);
  await pg.screenshot({ path: 'out/iv-rails.png' });
  const rb = await rail.locator('img').first().boundingBox();
  await pg.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2, { steps: 8 });
  await pg.waitForTimeout(4500);
  console.log('PLATE', await pg.evaluate(() => {
    const sp = document.querySelector('.svic-sec-hero>article:first-child .cs-overlay-content .cs-entry__title span');
    if (!sp) return 'no-span';
    const r = sp.getBoundingClientRect(), cs = getComputedStyle(sp);
    const top = r.width ? document.elementFromPoint(r.left + Math.min(20, r.width / 2), r.top + r.height / 2) : null;
    return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      color: cs.color, bg: cs.backgroundColor, vis: cs.visibility, fs: cs.fontSize,
      atPoint: top ? (top.tagName + '.' + String(top.className).slice(0, 30)) : 'offscreen' });
  }));
  console.log('RAILHOVER', await pg.evaluate(() => {
    const v = document.querySelector('video.svic-hv.on');
    if (!v) return 'none';
    return JSON.stringify({ src: v.currentSrc.split('/').pop(), paused: v.paused, rs: v.readyState, ns: v.networkState,
      err: v.error ? v.error.code : null, buf: v.buffered.length ? Math.round(v.buffered.end(0)) : 0,
      w: Math.round(v.getBoundingClientRect().width) });
  }));

  const pg2 = await ctx.newPage();
  await pg2.goto('https://test.siliconvalleyinvestclub.com/?z=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await pg2.waitForTimeout(10000);
  console.log('HOMEPLATE', await pg2.evaluate(() => {
    const t = document.querySelector('.cs-entry__overlay .cs-overlay-content .cs-entry__title');
    const four = [...document.querySelectorAll('.cs-overlay-content')].filter(el => /min/i.test(el.textContent) && getComputedStyle(el).display !== 'none').length;
    return JSON.stringify({ plateVisible: t ? getComputedStyle(t.closest('.cs-overlay-content')).display : 'missing', fourMinVisible: four });
  }));
  await pg2.screenshot({ path: 'out/home-top.png' });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
