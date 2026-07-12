const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })).newPage();
  await pg.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  await pg.goto('https://test.siliconvalleyinvestclub.com/2026/07/09/sambanova-raises-1-billion-at-an-11-billion-valuation/?z=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(9000);
  const before = await pg.evaluate(() => document.querySelectorAll('.cs-entry__post-related article').length);
  await pg.evaluate(() => document.querySelector('.cs-entry__post-related .svic-load-more').scrollIntoView({ block: 'center' }));
  await pg.waitForTimeout(700);
  await pg.click('.cs-entry__post-related .svic-load-more');
  await pg.waitForTimeout(4500);
  const after = await pg.evaluate(() => document.querySelectorAll('.cs-entry__post-related article').length);
  console.log('RELMORE', JSON.stringify({ before, after, btnStill: await pg.evaluate(() => !!document.querySelector('.cs-entry__post-related .svic-load-more')) }));
  await pg.screenshot({ path: 'out/relmore.png' });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
