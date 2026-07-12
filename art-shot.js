const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })).newPage();
  await pg.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  await pg.goto('https://test.siliconvalleyinvestclub.com/?z=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(9000);
  const r = await pg.evaluate(() => {
    const btns = [...document.querySelectorAll('button, a')].filter(e => /load more/i.test(e.textContent) && e.offsetParent);
    return btns.map(e => { const cs = getComputedStyle(e); const b2 = e.getBoundingClientRect(); return { text: e.textContent.trim(), tt: cs.textTransform, ls: cs.letterSpacing, y: Math.round(b2.top + scrollY) }; });
  });
  console.log('BTNS', JSON.stringify(r));
  if (r.length > 1) { await pg.evaluate(y => scrollTo(0, y - 400), r[0].y); await pg.waitForTimeout(900); }
  await pg.screenshot({ path: 'out/lm-btn.png' });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
