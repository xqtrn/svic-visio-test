/* iOS-26.5.2 Chrome emulator (Playwright WebKit — the same engine Chrome-for-iOS is forced
   to use). Instruments every <video>: counts src removals/re-adds and backward currentTime
   jumps (the "2s then restart" symptom) on the clip that is actually on-screen. */
const { webkit } = require('playwright');
const fs = require('fs');

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.0 Mobile/15E148 Safari/604.1';

const MONITOR = () => {
  window.__vlog = { srcRemoved: 0, srcAdded: 0, restarts: 0, restartDetail: [], hooked: 0 };
  const seen = new WeakSet();
  function onScreen(v){ const r = v.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.height > 0; }
  function hook(v){
    if (seen.has(v)) return; seen.add(v); window.__vlog.hooked++;
    let last = 0;
    v.addEventListener('timeupdate', () => {
      if (v.currentTime < last - 0.4 && last > 0.6 && last < 28){   // backward jump not explained by the 30->1 loop
        window.__vlog.restarts++;
        window.__vlog.restartDetail.push({ from: +last.toFixed(1), to: +v.currentTime.toFixed(1), onScreen: onScreen(v) });
      }
      last = v.currentTime;
    });
    new MutationObserver(ms => { for (const m of ms) if (m.attributeName === 'src'){
      if (v.getAttribute('src') === null) window.__vlog.srcRemoved++;
      else window.__vlog.srcAdded++;
    }}).observe(v, { attributes: true, attributeFilter: ['src'] });
  }
  new MutationObserver(() => document.querySelectorAll('video').forEach(hook)).observe(document.documentElement, { subtree: true, childList: true });
  setInterval(() => document.querySelectorAll('video').forEach(hook), 400);
};

(async () => {
  fs.mkdirSync('out', { recursive: true });
  const browser = await webkit.launch();
  const ctx = await browser.newContext({
    userAgent: UA, viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  await ctx.addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test3.siliconvalleyinvestclub.com', path: '/' }]);
  await ctx.addInitScript(MONITOR);
  const page = await ctx.newPage();
  await page.goto('https://test3.siliconvalleyinvestclub.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  let v = await page.evaluate(() => document.querySelectorAll('video').length);
  if (!v){ await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(7000); }

  const env = await page.evaluate(() => ({
    webkit: /AppleWebKit/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent),
    coarse: matchMedia('(pointer:coarse)').matches, videos: document.querySelectorAll('video').length,
    canH264: document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"'),
  }));

  // hold at top 12s (hero should stay put), then scroll the page in steps (triggers the governor),
  // then back to top — the whole time, watch for restarts / src removals on the on-screen clip
  const timeline = [];
  async function snap(tag){
    const s = await page.evaluate(() => {
      const vs = [...document.querySelectorAll('video')];
      return { t: Date.now(), vlog: JSON.parse(JSON.stringify(window.__vlog)),
        states: vs.map(x => ({ ct: +x.currentTime.toFixed(1), paused: x.paused, hasSrc: x.getAttribute('src') !== null,
          on: (() => { const r = x.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; })() })) };
    });
    timeline.push({ tag, ...s });
  }
  for (let i = 0; i < 24; i++){ await snap('top+' + i); await page.waitForTimeout(500); }
  await page.screenshot({ path: 'out/ios-top.png' });
  for (const y of [700, 1400, 2100, 2800, 1400, 0]){
    await page.evaluate(sy => window.scrollTo(0, sy), y);
    await page.waitForTimeout(1500); await snap('scroll' + y);
  }
  await page.screenshot({ path: 'out/ios-scrolled.png' });

  const final = timeline[timeline.length - 1].vlog;
  const report = { env, finalVlog: final, timeline };
  fs.writeFileSync('out/report.json', JSON.stringify(report, null, 2));
  await browser.close();
  console.log('ENV:', JSON.stringify(env));
  console.log('RESULT: srcRemoved=' + final.srcRemoved + ' srcAdded=' + final.srcAdded + ' restarts=' + final.restarts + ' hooked=' + final.hooked);
  console.log('RESTART_DETAIL:', JSON.stringify(final.restartDetail.slice(0, 8)));
})().catch(e => { console.error(e); process.exit(1); });
