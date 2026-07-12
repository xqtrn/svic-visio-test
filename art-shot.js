const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })).newPage();
  await pg.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  await pg.goto('https://test.siliconvalleyinvestclub.com/2026/07/09/sambanova-raises-1-billion-at-an-11-billion-valuation/?z=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(9000);
  console.log('DGAPS', await pg.evaluate(() => {
    const g = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { t: Math.round(r.top + scrollY), b: Math.round(r.bottom + scrollY) }; };
    const kick = g('.post-categories'), h1 = g('h1.cs-entry__title'), meta = g('.svic-meta'),
          hero = g('.cs-entry__media-wrap'), lede = g('.svic-lede'), colabel = g('.entry-content tr > td:only-child'),
          co = g('.entry-content table:nth-of-type(2)'), quote = g('.entry-content blockquote'),
          cta = g('.entry-content div:has(> a.profile-btn)'), tags = g('.cs-entry__tags'),
          relH = g('.cs-entry__post-related'), topbar = g('.topbar') || { b: 64 };
    const arthead = g('.svic-arthead');
    return JSON.stringify({
      topbarToKicker: kick && arthead ? kick.t - 64 : null,
      kickToH1: h1 && kick ? h1.t - kick.b : null,
      h1ToMeta: meta && h1 ? meta.t - h1.b : null,
      metaToHero: hero && meta ? hero.t - meta.b : null,
      heroToLede: lede && hero ? lede.t - hero.b : null,
      quoteMargins: quote ? 'ok' : null,
      ctaToTags: tags && cta ? tags.t - cta.b : null,
      tagsToRel: relH && tags ? relH.t - tags.b : null,
    });
  }));
  await pg.screenshot({ path: 'out/dsk-top.png' });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
