/* DOM probe: why does the dock Login button vanish? Open the drawer, measure the button
   before/after tapping it. */
const { webkit } = require('playwright');
const fs = require('fs');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.0 Mobile/15E148 Safari/604.1';
(async () => {
  fs.mkdirSync('out', { recursive: true });
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await ctx.addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test3.siliconvalleyinvestclub.com', path: '/' }]);
  const page = await ctx.newPage();
  await page.goto('https://test3.siliconvalleyinvestclub.com/?__ocopen=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  function probe(){
    return page.evaluate(() => {
      const w = document.querySelector('#t2Drawer .ul-wrap');
      const sec = w && w.querySelector('.oc-l1[data-nav="login"]');
      const hdr = sec && sec.querySelector('.oc-l1-hdr');
      if (!hdr) return { wrap: !!w, sec: !!sec, hdr: false };
      const r = hdr.getBoundingClientRect(); const cs = getComputedStyle(hdr);
      const col = sec.querySelector(':scope > .oc-collapse'); const cr = col ? col.getBoundingClientRect() : null;
      return { wrap: !!w, secOpen: sec.classList.contains('open'),
        hdr: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
          display: cs.display, vis: cs.visibility, bg: cs.backgroundColor, z: cs.zIndex, pos: cs.position },
        collapse: cr ? { y: Math.round(cr.y), h: Math.round(cr.height), pos: col ? getComputedStyle(col).position : null } : null,
        wrapRect: (() => { const wr = w.getBoundingClientRect(); return { y: Math.round(wr.y), h: Math.round(wr.height) }; })(),
        viewportH: innerHeight };
    });
  }
  const before = await probe();
  await page.screenshot({ path: 'out/probe-before.png' });
  await page.evaluate(() => { const h = document.querySelector('#t2Drawer .ul-wrap .oc-l1[data-nav="login"] .oc-l1-hdr'); if (h) h.click(); });
  await page.waitForTimeout(800);
  const after = await probe();
  await page.screenshot({ path: 'out/probe-after.png' });
  fs.writeFileSync('out/report.json', JSON.stringify({ before, after }, null, 2));
  await browser.close();
  console.log('BEFORE:', JSON.stringify(before));
  console.log('AFTER:', JSON.stringify(after));
})().catch(e => { console.error(e); process.exit(1); });
