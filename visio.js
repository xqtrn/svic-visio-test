/* Render-verify the 36-point plan: before / after / tour × desktop 1440 + mobile 390. */
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  fs.mkdirSync('out', { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const variants = [
    ['before', '/'],
    ['after', '/?__plan=1'],
    ['tour', '/?__plan=tour'],
  ];
  for (const [vname, path] of variants) {
    for (const [name, vp, mob] of [['desktop', { width: 1440, height: 900 }, false], ['mobile', { width: 390, height: 844 }, true]]) {
      const ctx = await browser.newContext({ viewport: vp, isMobile: mob, hasTouch: mob, deviceScaleFactor: 2 });
      await ctx.addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
      const page = await ctx.newPage();
      const errs = [];
      page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
      await page.goto('https://test.siliconvalleyinvestclub.com' + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(8000);
      if (vname === 'after' && name === 'mobile') {
        const probe = await page.evaluate(() => {
          const out = {};
          const hero = document.querySelector('.cs-entry__overlay');
          if (hero) { const r = hero.getBoundingClientRect(); out.heroAspect = +(r.width / r.height).toFixed(3); }
          const v = document.querySelector('video');
          if (v) out.video = { vw: v.videoWidth, vh: v.videoHeight, playing: !v.paused };
          const d = document.querySelector('.cs-entry__overlay .cs-meta-date');
          if (d) out.dateColor = getComputedStyle(d).color;
          const rail = document.querySelector('.cnvs-block-row-1587535409467');
          if (rail) {
            const es = [...rail.querySelectorAll('.cs-entry__outer')];
            const tops = es.map(e => Math.round(e.getBoundingClientRect().top + scrollY));
            out.railGaps = tops.slice(1).map((t, i) => t - tops[i] - Math.round(es[i].getBoundingClientRect().height));
          }
          out.planActive = !!document.querySelector('.svic-viewall');
          return out;
        });
        console.log('PROBE-AFTER-MOBILE:', JSON.stringify(probe));
      }
      await page.screenshot({ path: `out/${vname}-${name}-fold.png` });
      await page.screenshot({ path: `out/${vname}-${name}-full.png`, fullPage: true });
      console.log(`${vname}-${name}: console-errors=${errs.length}${errs.length ? ' :: ' + errs.slice(0, 4).join(' | ') : ''}`);
      await ctx.close();
    }
  }
  await browser.close();
  console.log('CAPTURED');
})().catch(e => { console.error(e); process.exit(1); });
