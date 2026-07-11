const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const A = 'https://test.siliconvalleyinvestclub.com/2026/07/09/sambanova-raises-1-billion-at-an-11-billion-valuation/?z=';
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 1250 }, deviceScaleFactor: 2 })).newPage();
  await pg.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  await pg.goto(A + Date.now(), { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(9000);
  console.log('ORDER', await pg.evaluate(() => {
    const h1 = document.querySelector('h1.cs-entry__title');
    const hero = document.querySelector('.cs-entry__media-large');
    const lede = document.querySelector('.svic-lede');
    return JSON.stringify({ h1Top: Math.round(h1.getBoundingClientRect().top + scrollY), heroTop: Math.round(hero.getBoundingClientRect().top + scrollY), ledeTop: Math.round(lede.getBoundingClientRect().top + scrollY), heroW: Math.round(hero.getBoundingClientRect().width) });
  }));
  console.log('MP', await pg.evaluate(() => JSON.stringify({
    kickers: [...document.querySelectorAll('.post-categories li')].filter(li => getComputedStyle(li).display !== 'none').length,
    meta: (document.querySelector('.svic-meta') || {}).textContent || null,
    lede: !!document.querySelector('.svic-lede'),
    rp: !!document.querySelector('.svic-rp'),
  })));
  await pg.screenshot({ path: 'out/mp-top.png' });
  await pg.evaluate(() => scrollTo(0, document.body.scrollHeight * 0.45));
  await pg.waitForTimeout(1000);
  await pg.screenshot({ path: 'out/mp-mid.png' });
  await pg.evaluate(() => { const e = document.querySelector('.cs-entry__prev-next'); if (e) e.scrollIntoView({ block: 'center' }); });
  await pg.waitForTimeout(900);
  await pg.screenshot({ path: 'out/mp-end.png' });
  await pg.close();
  const m = await (await b.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })).newPage();
  await m.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  await m.goto(A + (Date.now() + 1), { waitUntil: 'domcontentloaded' });
  await m.waitForTimeout(8000);
  await m.evaluate(() => scrollTo(0, 500));
  await m.waitForTimeout(800);
  await m.screenshot({ path: 'out/mp-mobile.png' });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
