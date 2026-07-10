const { chromium } = require('playwright');
(async () => {
  require('fs').mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 1400 }, deviceScaleFactor: 2 })).newPage();
  await pg.context().addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test3.siliconvalleyinvestclub.com', path: '/' }]);
  await pg.goto('https://test3.siliconvalleyinvestclub.com/2026/06/01/base-power-to-raise-1-billion-at-a-12-billion-valuation/?__x=v6', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(7000);
  await pg.screenshot({ path: 'out/arx-v6-top.png' });
  console.log('CSSDBG', await pg.evaluate(() => {
    const w = document.querySelector('.cs-entry__content-wrap'), c = document.querySelector('.cs-entry__container');
    const cw = getComputedStyle(w), cc = getComputedStyle(c);
    let hit = [];
    for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch(e) { continue; }
      const walk = rs => { for (const r of rs) { if (r.cssRules) { walk(r.cssRules); continue; } if (r.selectorText && r.selectorText.includes('cs-entry__container') && r.style && (r.style.gridTemplateColumns || r.style.width)) hit.push((r.parentRule && r.parentRule.conditionText ? '@' + r.parentRule.conditionText + ' ' : '') + r.selectorText + ' {' + r.style.cssText.slice(0, 90) + '}'); } };
      walk(sh.cssRules); }
    return JSON.stringify({ wWidth: cw.width, wGridCol: cw.gridColumnStart + '/' + cw.gridColumnEnd, wVar: cw.getPropertyValue('--cs-entry-content-width'), cTpl: cc.gridTemplateColumns, cJust: cc.justifyItems, rules: hit.slice(0, 8) });
  }));
  console.log('CHAIN', await pg.evaluate(() => {
    let e = document.querySelector('.cs-entry__content-wrap'); const out = [];
    for (let i = 0; i < 6 && e; i++) { const b = e.getBoundingClientRect(), c = getComputedStyle(e);
      out.push([e.className.split(' ').slice(0,2).join('.') || e.tagName, Math.round(b.left), Math.round(b.width), c.display, c.gridTemplateColumns !== 'none' ? c.gridTemplateColumns : '', c.maxWidth, c.marginLeft]);
      e = e.parentElement; }
    return JSON.stringify(out);
  }));
  console.log('GEO', await pg.evaluate(() => {
    const r = s => { const e = document.querySelector(s); if(!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.width)]; };
    const cw = document.querySelector('.cs-entry__content-wrap');
    return JSON.stringify({ h1: r('h1.cs-entry__title'), facts: r('.svic-facts'), p: r('.entry-content > p'), ec: r('.entry-content'), wrap: r('.cs-entry__content-wrap'), hinfo: r('.cs-entry__header-info'), header: r('.cs-entry__header'), wrapDisp: cw ? getComputedStyle(cw).display + '|' + getComputedStyle(cw).gridTemplateColumns : null, meta: !!document.querySelector('.cs-entry__meta') });
  }));
  console.log('PROBE', await pg.evaluate(() => JSON.stringify({
    prov: !!document.querySelector('.svic-prov'),
    facts: document.querySelectorAll('.svic-facts > div').length,
    sidebarHidden: (function(){var a=document.querySelector('.cs-sidebar__area');return a?getComputedStyle(a).display==='none':null})(),
    shareHidden: (function(){var a=document.querySelector('.cs-entry__share-buttons');return a?getComputedStyle(a).display==='none':null})(),
    close: !!document.querySelector('.svic-close'),
    heroImgW: (function(){var i=document.querySelector('.cs-entry__media-large img');return i?i.naturalWidth:null})()
  })));
  await pg.evaluate(() => document.querySelector('.svic-close').scrollIntoView({ block: 'center' }));
  await pg.waitForTimeout(800);
  await pg.screenshot({ path: 'out/arx-v6-close.png' });
  console.log('CAPTURED');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
