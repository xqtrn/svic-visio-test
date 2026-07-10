const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 })).newPage();
  await pg.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  await pg.goto('https://test.siliconvalleyinvestclub.com/2026/07/08/chapter-hits-3b-valuation-with-100m-raise-interview-with-cobi-blumenfeld-gantz-ceo-co-founder/?z=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(9000);
  console.log('CHAPTER', JSON.stringify(await pg.evaluate(()=>{
    const f=document.querySelector('.cs-entry__media-large iframe, .svic-yt iframe');
    const v=document.querySelector('.cs-entry__media-large video');
    const link=document.querySelector('.cs-entry__media-large .cs-player-link, .cs-video-controls .cs-player-link');
    return {iframe:f?f.src.slice(0,60):null, selfHostVideo:v?(v.currentSrc||v.src).split('/').pop():null, viewOnYouTube: link?link.href:null};
  })));
  await pg.screenshot({ path: 'out/vid-hero.png' });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
