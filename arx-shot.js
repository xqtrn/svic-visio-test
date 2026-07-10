const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 1400 }, deviceScaleFactor: 2 })).newPage();
  await pg.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test3.siliconvalleyinvestclub.com', path: '/' }]);
  await pg.goto('https://test3.siliconvalleyinvestclub.com/2026/06/01/base-power-to-raise-1-billion-at-a-12-billion-valuation/?__x=v6', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(7000);
  await pg.screenshot({ path: 'out/arx-v6-top.png' });
  console.log('PROBE', await pg.evaluate(() => JSON.stringify({
    prov: !!document.querySelector('.svic-prov'),
    facts: document.querySelectorAll('.svic-facts > div').length,
    sidebarHidden: (function(){var a=document.querySelector('.cs-sidebar__area');return a?getComputedStyle(a).display==='none':null})(),
    shareHidden: (function(){var a=document.querySelector('.cs-entry__share-buttons');return a?getComputedStyle(a).display==='none':null})(),
    close: !!document.querySelector('.svic-close'),
    heroImgW: (function(){var i=document.querySelector('.cs-entry__media-large img');return i?i.naturalWidth:null})()
  })));
  await pg.evaluate(() => document.querySelector('.svic-close').scrollIntoView({ block: 'center' }));
  await pg.waitForTimeout(800);
  await pg.screenshot({ path: 'out/arx-v6-close.png' });
  console.log('CAPTURED');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
