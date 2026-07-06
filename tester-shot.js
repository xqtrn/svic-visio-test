const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test3.siliconvalleyinvestclub.com', path: '/' }]);
  const pg = await ctx.newPage();
  await pg.goto('https://test3.siliconvalleyinvestclub.com/__faces', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(6000);
  require('fs').mkdirSync('out', { recursive: true });
  await pg.screenshot({ path: 'out/faces-tester.png' });
  console.log('CAPTURED cards=' + await pg.locator('.card').count());
  // rail-eq probe: уровни разделителей рейла на десктопе
  await pg.goto('https://test3.siliconvalleyinvestclub.com/', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(6000);
  const eq = await pg.evaluate(() => {
    const row = document.querySelector('.cnvs-block-row-1587535409467');
    const mains = [...row.querySelectorAll('.cnvs-block-posts-layout-horizontal-type-2 .cs-posts-area__main')];
    return [0,1].map(i => mains.map(b => { const a = b.children[i]; const c = a && a.querySelector('.cs-entry__content');
      return c ? Math.round(c.getBoundingClientRect().bottom + scrollY) : null; }));
  });
  console.log('RAIL-EQ rows bottoms:', JSON.stringify(eq));
  const rail = await pg.locator('.cnvs-block-row-1587535409467').boundingBox();
  await pg.screenshot({ path: 'out/rail-eq.png', clip: { x: rail.x, y: rail.y, width: Math.min(rail.width, 1400), height: Math.min(rail.height, 700) } });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
