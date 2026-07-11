const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 })).newPage();
  await pg.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  await pg.goto('https://test.siliconvalleyinvestclub.com/2026/07/09/sambanova-raises-1-billion-at-an-11-billion-valuation/?z=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(9000);
  console.log('WHOIS', await pg.evaluate(() => {
    const host = document.querySelector('.cs-entry__media-large .cs-entry__media-wrap');
    const r = host.getBoundingClientRect();
    const pts = [[r.left + 40, r.top + 45], [r.left + 35, r.top + 35], [r.left + 50, r.top + 50]];
    const seen = [];
    for (const [x, y] of pts) {
      for (const el of document.elementsFromPoint(x, y).slice(0, 5)) {
        const d = el.tagName + '.' + (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').toString().slice(0, 50) + (el.id ? '#' + el.id : '');
        if (!seen.includes(d)) seen.push(d);
      }
    }
    return JSON.stringify(seen.slice(0, 14));
  }));
  await pg.screenshot({ path: 'out/pl-desktop.png' });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
