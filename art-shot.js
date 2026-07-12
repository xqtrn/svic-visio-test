const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const m = await (await b.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })).newPage();
  await m.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  await m.goto('https://test.siliconvalleyinvestclub.com/2026/07/09/sambanova-raises-1-billion-at-an-11-billion-valuation/?z=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await m.waitForTimeout(9000);
  console.log('GAPS', await m.evaluate(() => {
    const g = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { t: Math.round(r.top + scrollY), b: Math.round(r.bottom + scrollY), h: Math.round(r.height) }; };
    const meta = g('.svic-meta'), hero = g('.cs-entry__media-large'), wrap = g('.cs-entry__media-wrap'),
          lede = g('.svic-lede'), co = g('.entry-content table'), cta = g('.entry-content a.profile-btn'),
          tags = g('.cs-entry__tags'), rel = g('.cs-entry__post-related');
    const heroCS = getComputedStyle(document.querySelector('.cs-entry__media-large'));
    const innerCS = getComputedStyle(document.querySelector('.cs-entry__media-inner'));
    return JSON.stringify({
      metaToHero: hero && meta ? hero.t - meta.b : null,
      heroH: hero ? hero.h : null, wrapH: wrap ? wrap.h : null,
      heroToLede: lede && hero ? lede.t - hero.b : null,
      heroMargins: heroCS.marginTop + '/' + heroCS.marginBottom + ' pad:' + heroCS.paddingTop + '/' + heroCS.paddingBottom,
      innerH: Math.round(document.querySelector('.cs-entry__media-inner').getBoundingClientRect().height),
      innerPad: innerCS.paddingTop + '/' + innerCS.paddingBottom,
      ledeToCo: co && lede ? co.t - lede.b : null,
      ctaToTags: tags && cta ? tags.t - cta.b : null,
      chain: ['.cs-site-content','.cs-container','.cs-main-content','.cs-content-area','.cs-entry__wrap','.cs-entry__container','.cs-entry__content-wrap'].map(sel => { const e = document.querySelector(sel); if (!e) return sel + ':none'; const cs = getComputedStyle(e); return sel.replace('.cs-','') + ' mt:' + cs.marginTop + ' pt:' + cs.paddingTop; }),
      tagsToRel: rel && tags ? rel.t - tags.b : null,
    });
  }));
  await m.screenshot({ path: 'out/mob-rhythm.png' });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
