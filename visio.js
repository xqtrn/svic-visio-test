/* Ground truth for the rounded ring: desktop Chrome, narrow window, open drawer, click
   MEDIA; report document.activeElement + its computed outline + screenshot the region. */
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  fs.mkdirSync('out', { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 600, height: 900 } });
  await ctx.addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test3.siliconvalleyinvestclub.com', path: '/' }]);
  const page = await ctx.newPage();
  await page.goto('https://test3.siliconvalleyinvestclub.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);
  await page.click('#t2Burger');
  await page.waitForTimeout(600);
  const mediaBtn = page.locator('#t2Drawer .oc-l1[data-nav="media"] > .oc-l1-hdr');
  await mediaBtn.click();
  await page.waitForTimeout(600);
  const probe = await page.evaluate(() => {
    const ae = document.activeElement;
    const cs = ae ? getComputedStyle(ae) : null;
    const hdr = document.querySelector('#t2Drawer .oc-l1[data-nav="media"] > .oc-l1-hdr');
    const hs = hdr ? getComputedStyle(hdr) : null;
    const panel = document.getElementById('t2Drawer');
    const ps = getComputedStyle(panel);
    return {
      active: ae ? (ae.tagName + '.' + (ae.className || '').toString().slice(0, 60)) : null,
      activeOutline: cs ? cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor : null,
      hdrOutline: hs ? hs.outlineStyle + ' ' + hs.outlineWidth + ' ' + hs.outlineColor : null,
      hdrBorderLeft: hs ? hs.borderLeftWidth + ' ' + hs.borderLeftColor : null,
      hdrRadius: hs ? hs.borderRadius : null,
      panelOutline: ps.outlineStyle + ' ' + ps.outlineWidth + ' ' + ps.outlineColor,
      panelShadow: ps.boxShadow.slice(0, 120),
    };
  });
  await page.screenshot({ path: 'out/ring.png', clip: { x: 0, y: 120, width: 480, height: 500 } });
  fs.writeFileSync('out/report.json', JSON.stringify(probe, null, 2));
  await browser.close();
  console.log('PROBE:', JSON.stringify(probe));
})().catch(e => { console.error(e); process.exit(1); });
