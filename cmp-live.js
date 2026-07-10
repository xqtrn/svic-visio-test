const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1.5 });
  await ctx.addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  const art = '2026/07/08/chapter-hits-3b-valuation-with-100m-raise-interview-with-cobi-blumenfeld-gantz-ceo-co-founder';
  for (const [label, base] of [['live','https://siliconvalleyinvestclub.com'],['test','https://test.siliconvalleyinvestclub.com']]) {
    const pg = await ctx.newPage();
    await pg.goto(`${base}/${art}/?z=`+Date.now(), { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(8000);
    const info = await pg.evaluate(()=>{
      const mi=document.querySelector('.cs-entry__media-large, .cs-entry__media');
      const v=mi?mi.querySelector('video'):null, f=mi?mi.querySelector('iframe'):null, img=mi?mi.querySelector('img'):null;
      return {hero: mi?mi.className:'none', video:v?(v.currentSrc||v.src).slice(-50):null, iframe:f?f.src.slice(0,55):null, img:img?img.src.split('/').pop().slice(0,30):null};
    });
    console.log(label.toUpperCase(), JSON.stringify(info));
    await pg.screenshot({ path: `out/cmp-${label}.png` });
    await pg.close();
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
