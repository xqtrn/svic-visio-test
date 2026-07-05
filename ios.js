/* iOS-engine test (Playwright WebKit + CriOS UA) of plan points 39/40 on mobile after. */
const { webkit } = require('playwright');
const fs = require('fs');
(async () => {
  fs.mkdirSync('out', { recursive: true });
  const browser = await webkit.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  });
  await ctx.addCookies([
    { name: 'svic_token', value: 'edge-preview', domain: 'test3.siliconvalleyinvestclub.com', path: '/' },
    { name: 'svic_plan', value: '1', domain: 'test3.siliconvalleyinvestclub.com', path: '/' },
  ]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  await page.goto('https://test3.siliconvalleyinvestclub.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.tap('body').catch(() => {});   // unlock muted autoplay (WebKit)
  await page.waitForTimeout(9000);
  const probe = await page.evaluate(() => {
    const out = { ua: navigator.userAgent.slice(0, 40) };
    const hero = document.querySelector('.cs-entry__overlay');
    if (hero) { const r = hero.getBoundingClientRect(); out.heroAspect = +(r.width / r.height).toFixed(3); }
    const v = document.querySelector('video');
    if (v) out.video = { vw: v.videoWidth, vh: v.videoHeight, playing: !v.paused, rs: v.readyState, ct: +v.currentTime.toFixed(1) };
    const d = document.querySelector('.cs-entry__overlay .cs-meta-date');
    if (d) { const cs = getComputedStyle(d); out.date = { color: cs.color, shadow: cs.textShadow.slice(0, 40) }; }
    const rail = document.querySelector('.cnvs-block-row-1587535409467');
    if (rail) {
      const es = [...rail.querySelectorAll('.cs-entry__outer')];
      out.railCount = es.length;
      const rects = es.map(e => e.getBoundingClientRect());
      out.railGaps = rects.slice(1).map((r, i) => Math.round(r.top - rects[i].bottom));
    }
    out.planActive = !!document.querySelector('.svic-viewall');
    out.hasSampler = !!document.querySelector('.cs-video-wrapper[data-svic-vid]');
    return out;
  });
  console.log('PROBE-IOS:', JSON.stringify(probe));
  await page.screenshot({ path: 'out/ios-fold.png' });
  // rail region shot: scroll to the unicorn rail and capture
  await page.evaluate(() => { const r = document.querySelector('.cnvs-block-row-1587535409467'); if (r) r.scrollIntoView({ block: 'start' }); });
  await page.waitForTimeout(1200);
  const probe2 = await page.evaluate(() => {
    const rail = document.querySelector('.cnvs-block-row-1587535409467');
    const es = rail ? [...rail.querySelectorAll('.cs-entry__outer')] : [];
    const rects = es.map(e => e.getBoundingClientRect());
    return { railGapsScrolled: rects.slice(1).map((r, i) => Math.round(r.top - rects[i].bottom)) };
  });
  console.log('PROBE-IOS-RAIL:', JSON.stringify(probe2));
  await page.screenshot({ path: 'out/ios-rail.png' });
  await page.screenshot({ path: 'out/ios-full.png', fullPage: true });
  console.log('ios console-errors=' + errs.length + (errs.length ? ' :: ' + errs.slice(0, 4).join(' | ') : ''));
  await browser.close();
  console.log('CAPTURED');
})().catch(e => { console.error(e); process.exit(1); });
