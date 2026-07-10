const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 })).newPage();
  await pg.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  await pg.goto('https://test.siliconvalleyinvestclub.com/2026/06/05/supabase-raises-500-million-at-a-10-5-billion-valuation/?z=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(9000);
  console.log('SUPABASE', JSON.stringify(await pg.evaluate(()=>{const v=document.querySelector('.cs-entry__media-large video');return v?{src:(v.currentSrc||v.src).split('/svic-video/')[1],paused:v.paused,t:+v.currentTime.toFixed(1),w:v.videoWidth}:{none:true}})));
  await pg.screenshot({ path: 'out/vid-hero.png' });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
