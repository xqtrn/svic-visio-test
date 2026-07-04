const { chromium, devices } = require('playwright');
const fs = require('fs');
(async () => {
  fs.mkdirSync('out', { recursive: true });
  const browser = await chromium.launch();
  const report = { mobile: {}, desktop: {} };

  // ── mobile: iPhone 13 emulation (touch => pointer:coarse => governor active) ──
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });  // touch => pointer:coarse => governor; default UA so the theme mounts videos
  await mctx.addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test3.siliconvalleyinvestclub.com', path: '/' }]);
  const mp = await mctx.newPage();
  const consoleErrs = []; const failedReqs = [];
  mp.on('response', r => { if (r.status() >= 400) failedReqs.push(r.status() + ' ' + r.url().slice(0, 120)); });
  mp.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 160)); });
  await mp.goto('https://test3.siliconvalleyinvestclub.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await mp.waitForTimeout(14000);                      // let the queue mount the hero video
  // slow CI parse can outlive the player's 2.5s init retries — a warm reload fixes it
  let vcount = await mp.evaluate(() => document.querySelectorAll('video').length);
  if (vcount === 0){
    await mp.reload({ waitUntil: 'domcontentloaded' });
    await mp.waitForTimeout(9000);
  }
  report.mobileEnv = await mp.evaluate(() => ({
    wrappers: document.querySelectorAll('.cs-video-wrapper[data-svic-vid]').length,
    playerTag: !!document.querySelector('script[src*="svic-video"]'),
    videos: document.querySelectorAll('video').length,
    spinners: document.querySelectorAll('.svic-spinner').length,
    coarse: matchMedia('(pointer:coarse)').matches,
    rekickPresent: document.documentElement.outerHTML.indexOf('rekick')>-1,
    playerTags: document.querySelectorAll('script[src*="svic-video"]').length,
    doneAttrs: document.querySelectorAll('[data-svic-done]').length,
    ua: navigator.userAgent.slice(0, 60),
  }));
  const timeline = [];
  for (let i = 0; i < 40; i++) {                       // 20s @ 500ms
    const s = await mp.evaluate(() => {
      const v = document.querySelector('video');
      if (!v) return null;
      return { t: Math.round(v.currentTime * 100) / 100, paused: v.paused, ready: v.readyState, net: v.networkState, err: v.error ? v.error.code : 0, videos: document.querySelectorAll('video').length, withSrc: [...document.querySelectorAll('video')].filter(x => x.getAttribute('src') !== null).length };
    });
    timeline.push(s);
    if (i === 4)  await mp.screenshot({ path: 'out/m-frame-early.png' });
    if (i === 20) await mp.screenshot({ path: 'out/m-frame-mid.png' });
    if (i === 39) await mp.screenshot({ path: 'out/m-frame-late.png' });
    await mp.waitForTimeout(500);
  }
  // scroll phase: the active clip must switch, exactly one src attached at a time
  await mp.evaluate(() => { const vs = document.querySelectorAll('video'); if (vs[1]) vs[1].scrollIntoView({ block: 'center' }); });
  await mp.waitForTimeout(3500);
  report.mobileScroll = await mp.evaluate(() => {
    const vs = [...document.querySelectorAll('video')];
    return { videos: vs.length, withSrc: vs.filter(v => v.getAttribute('src') !== null).length,
      playing: vs.map(v => !v.paused), times: vs.map(v => Math.round(v.currentTime * 10) / 10) };
  });
  await mp.screenshot({ path: 'out/m-after-scroll.png' });
  const ts = timeline.filter(Boolean).map(x => x.t);
  let resets = 0;
  for (let i = 1; i < ts.length; i++) if (ts[i] < ts[i - 1] - 0.5 && ts[i - 1] < 28) resets++;   // drop not explained by the 30s->1s loop
  report.mobile = { failedReqs: failedReqs.slice(0,10), samples: timeline, resets, maxT: Math.max(...ts), consoleErrs: consoleErrs.slice(0, 10) };

  // ── desktop: scroll down, check the to-top button paints with the chevron ──
  const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await dctx.addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test3.siliconvalleyinvestclub.com', path: '/' }]);
  const dp = await dctx.newPage();
  await dp.goto('https://test3.siliconvalleyinvestclub.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dp.waitForTimeout(2500);
  await dp.evaluate(() => window.scrollTo(0, 2400));
  await dp.waitForTimeout(1200);
  report.desktop.toTop = await dp.evaluate(() => {
    const b = document.querySelector('.pk-scroll-to-top');
    if (!b) return { present: false };
    const cs = getComputedStyle(b), r = b.getBoundingClientRect();
    const af = getComputedStyle(b, '::after');
    return { present: true, visible: cs.display !== 'none' && r.width > 0, w: r.width, h: r.height, bg: cs.backgroundColor, radius: cs.borderRadius, arrowW: af.width, arrowBorder: af.borderLeftWidth + ' ' + af.borderLeftColor, x: Math.round(r.x), y: Math.round(r.y) };
  });
  await dp.screenshot({ path: 'out/d-bottom.png', clip: { x: 1440 - 220, y: 900 - 220, width: 220, height: 220 } });
  await dp.screenshot({ path: 'out/d-full.png' });
  fs.writeFileSync('out/report.json', JSON.stringify(report, null, 2));
  await browser.close();
  console.log('ENV:', JSON.stringify(report.mobileEnv)); console.log('FAILED:', JSON.stringify(report.mobile.failedReqs)); console.log('SCROLL:', JSON.stringify(report.mobileScroll)); console.log('RESETS:', report.mobile.resets, 'MAXT:', report.mobile.maxT, 'ERRS:', JSON.stringify(report.mobile.consoleErrs.slice(0,4))); console.log('TOTOP:', JSON.stringify(report.desktop.toTop));
})().catch(e => { console.error(e); process.exit(1); });
