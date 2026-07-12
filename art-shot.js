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
    const el = document.querySelector('.svic-sec-hero>article:first-child .cs-overlay-content');
    if (!el) return 'missing';
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + 40, r.top + r.height / 2);
    return JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height), covered: top ? top.className.toString().slice(0, 40) : null });
  }));
  console.log('RAILHOVER', await pg.evaluate(() => {
    const on = [...document.querySelectorAll('video.svic-hv.on')];
    return JSON.stringify({ on: on.length, playing: on.filter(v => !v.paused && v.readyState >= 2).length });
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
