const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })).newPage();
  await pg.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  // interviews: герой без navy-полей + без рейки
  await pg.goto('https://test.siliconvalleyinvestclub.com/interviews/?z=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(8000);
  await pg.screenshot({ path: 'out/intv.png' });
  // главная: тумбы Chapter/Crusoe
  await pg.goto('https://test.siliconvalleyinvestclub.com/?z=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(8000);
  const r = await pg.evaluate(() => {
    const a = [...document.querySelectorAll('article')].find(x => /Chapter Hits/.test(x.textContent));
    const c = [...document.querySelectorAll('article')].find(x => /Crusoe to Raise/.test(x.textContent));
    const gr = e => { const b2 = e.getBoundingClientRect(); return { x: b2.x, y: b2.y + scrollY, w: b2.width, h: b2.height }; };
    return { ch: a ? gr(a) : null, cr: c ? gr(c) : null };
  });
  if (r.ch) { await pg.evaluate(y => scrollTo(0, y - 120), r.ch.y); await pg.waitForTimeout(1200); await pg.screenshot({ path: 'out/cards.png' }); }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
