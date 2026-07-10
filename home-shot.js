const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 1600 }, deviceScaleFactor: 2 })).newPage();
  await pg.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test3.siliconvalleyinvestclub.com', path: '/' }]);
  await pg.goto('https://test3.siliconvalleyinvestclub.com/?z=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(8000);
  console.log('PROBE', await pg.evaluate(() => {
    const cards = [...document.querySelectorAll('.cs-posts-area__main .cs-entry')].slice(0, 10);
    const dates = [...document.querySelectorAll('.cs-posts-area__main .cs-meta-date')].slice(0, 6).map(e => e.textContent.trim());
    const firstImg = document.querySelector('.cs-posts-area__main img');
    const heroOverlay = document.querySelector('.cs-posts-area__main .cs-overlay-ratio, .cs-posts-area__main .cs-entry__overlay');
    const r = heroOverlay ? heroOverlay.getBoundingClientRect() : null;
    return JSON.stringify({ topDates: dates, cardCount: document.querySelectorAll('.cs-posts-area__main .cs-entry').length, firstAspect: r ? +(r.width / r.height).toFixed(3) : null, firstObjPos: firstImg ? getComputedStyle(firstImg).objectPosition : null });
  }));
  await pg.screenshot({ path: 'out/home-top.png' });
  await pg.evaluate(() => window.scrollTo(0, 1400));
  await pg.waitForTimeout(1500);
  await pg.screenshot({ path: 'out/home-mid.png' });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
