/* iOS 26.5.2 Chrome emulator (Playwright WebKit = Chrome-for-iOS engine). A real tap unlocks
   muted autoplay (as the first touch on a phone does), then the hero's currentTime is tracked
   for 24s to catch the "~2s then restart" backward jump. Also confirms src is never stripped. */
const { webkit } = require('playwright');
const fs = require('fs');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.0 Mobile/15E148 Safari/604.1';

(async () => {
  fs.mkdirSync('out', { recursive: true });
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await ctx.addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test3.siliconvalleyinvestclub.com', path: '/' }]);
  await ctx.addInitScript(() => {
    window.__vids = []; window.__vseq = 0;
    const tag = (v) => { if (v.__vid) return; v.__vid = ++window.__vseq; window.__vids.push({ id: v.__vid, at: Date.now() }); };
    new MutationObserver(() => document.querySelectorAll('video').forEach(tag)).observe(document.documentElement, { subtree: true, childList: true });
    setInterval(() => document.querySelectorAll('video').forEach(tag), 200);
  });
  const page = await ctx.newPage();
  await page.goto('https://test3.siliconvalleyinvestclub.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  if (!(await page.evaluate(() => document.querySelectorAll('video').length))) { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(7000); }

  const env = await page.evaluate(() => ({ webkit: /AppleWebKit/.test(navigator.userAgent), coarse: matchMedia('(pointer:coarse)').matches, videos: document.querySelectorAll('video').length, canH264: document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"') }));

  // real user gesture — unlock muted autoplay like the first touch on iOS
  await page.touchscreen.tap(196, 300);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const v = document.querySelector('video'); if (!v) return;
    window.__ev = [];
    ['ended','emptied','loadstart','stalled','waiting','seeking','seeked','pause','play','durationchange','error'].forEach(function(t){
      v.addEventListener(t, function(){ window.__ev.push(t + '@' + v.currentTime.toFixed(2) + (t==='error'&&v.error?(' code'+v.error.code):'')); });
    });
    v.__meta = { loop: v.loop, dataEnd: (v.closest('.cs-entry__overlay')||document).querySelector ? null : null };
    document.querySelectorAll('video').forEach(function(x){ x.loop = false; });  // EXPERIMENT: kill native short-loop
    v.muted = true; const p = v.play(); if (p && p.catch) p.catch(() => {});
    v.addEventListener('ended', function(){ window.__endedAt = +v.currentTime.toFixed(2); });  // does it end at ~3 or ~30?
  });

  // track the hero for 24s (500ms), detecting backward jumps not explained by the 30->1 loop
  const samples = [], restarts = [];
  let last = -1, maxCt = 0, srcGone = 0;
  for (let i = 0; i < 62; i++) {
    const s = await page.evaluate(() => { const v = document.querySelector('video'); if (!v) return null; return { ct: +v.currentTime.toFixed(2), vid: v.__vid, paused: v.paused, hasSrc: v.getAttribute('src') !== null }; });
    if (s) { samples.push(s.ct + '#' + s.vid); if (!s.hasSrc) srcGone++; maxCt = Math.max(maxCt, s.ct);
      if (last >= 0 && s.ct < last - 0.4 && last > 0.6 && last < 28) restarts.push({ from: last, to: s.ct, i });
      last = s.ct; }
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: 'out/ios-hero.png' });

  const extra = await page.evaluate(() => { const v = document.querySelector('video'); const w = document.querySelector('.cs-video-wrapper[data-svic-vid]');
    return { loop: v ? v.loop : null, duration: v ? +(v.duration||0).toFixed(2) : null, ended: v ? v.ended : null,
      dataEnd: w ? w.getAttribute('data-video-end') : null, dataStart: w ? w.getAttribute('data-video-start') : null,
      srcAttr: v ? (v.getAttribute('src')||'').slice(-40) : null, events: (window.__ev||[]).slice(0, 40), endedAt: window.__endedAt, totalVideosCreated: window.__vseq, vidTimeline: window.__vids.slice(0, 20) }; });
  const report = { env, extra, hero: { played: maxCt > 3, maxCt, restarts, srcGone, samples } };
  fs.writeFileSync('out/report.json', JSON.stringify(report, null, 2));
  await browser.close();
  console.log('ENV:', JSON.stringify(env));
  console.log('HERO: played=' + (maxCt > 3) + ' maxCt=' + maxCt + ' restarts=' + restarts.length + ' srcGone=' + srcGone);
  console.log('SAMPLES:', samples.join(' '));
  console.log('RESTARTS:', JSON.stringify(restarts));
  console.log('EXTRA:', JSON.stringify(extra));
  console.log('VIDS_CREATED:', extra.totalVideosCreated, JSON.stringify(extra.vidTimeline));
})().catch(e => { console.error(e); process.exit(1); });
