/* iOS WebKit test of /vault/positron: layout-overflow + focus-zoom root-cause probes. */
const { webkit } = require('playwright');
const fs = require('fs');
(async () => {
  fs.mkdirSync('out', { recursive: true });
  const browser = await webkit.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  });
  const errs = [];
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 160)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });

  const overflowProbe = () => {
    const iw = window.innerWidth, out = { innerWidth: iw, scrollWidth: document.documentElement.scrollWidth, offenders: [] };
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 5 && (r.right > iw + 2 || r.left < -2) && el.children.length < 12) {
        out.offenders.push({ sel: (el.id ? '#' + el.id : el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName), w: Math.round(r.width), right: Math.round(r.right) });
        if (out.offenders.length >= 12) break;
      }
    }
    out.vvScale = window.visualViewport ? +window.visualViewport.scale.toFixed(3) : null;
    return out;
  };

  // ── Stage 1: gate (no cookie) — input font sizes (iOS auto-zoom trigger <16px)
  await page.goto('https://platform.siliconvalleyinvestclub.com/vault/positron', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  const gate = await page.evaluate(() => {
    const fs = s => { const el = document.querySelector(s); return el ? getComputedStyle(el).fontSize : null; };
    return { email: fs('#email'), vname: fs('#vname'), code: fs('.code-in') || fs('#code'), reqBtn: fs('#reqBtn') };
  });
  const gateOv = await page.evaluate(overflowProbe);
  await page.screenshot({ path: 'out/i1-gate.png' });
  console.log('GATE-FONTS:', JSON.stringify(gate));
  console.log('GATE-OVERFLOW:', JSON.stringify(gateOv));

  // ── Stage 2: login via cookie, home overview
  await ctx.addCookies([{ name: 'svic_vault_positron', value: process.env.VAULT_TOKEN, domain: 'platform.siliconvalleyinvestclub.com', path: '/' }]);
  await page.goto('https://platform.siliconvalleyinvestclub.com/vault/positron?vt=ios1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);
  const homeOv = await page.evaluate(overflowProbe);
  await page.screenshot({ path: 'out/i2-home.png' });
  console.log('HOME-OVERFLOW:', JSON.stringify(homeOv));

  // ── Stage 3: open the SPV packet document (deep link), measure reader
  await page.goto('https://platform.siliconvalleyinvestclub.com/vault/positron?vt=ios2#doc=1&p=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000); // let PDF.js render
  const reader = await page.evaluate(() => {
    const iw = window.innerWidth;
    const bar = document.querySelector('.v-bar');
    const canvas = document.querySelector('.v-doc canvas');
    const side = document.querySelector('.v-side');
    const r = x => x ? { w: Math.round(x.getBoundingClientRect().width), right: Math.round(x.getBoundingClientRect().right) } : null;
    return {
      innerWidth: iw, scrollWidth: document.documentElement.scrollWidth,
      bar: r(bar), barScrollW: bar ? bar.scrollWidth : null,
      canvas: r(canvas), canvasCssW: canvas ? canvas.style.width : null,
      side: r(side), sideVisible: side ? getComputedStyle(side).transform : null,
      pgInputFs: (() => { const el = document.querySelector('.v-pg input'); return el ? getComputedStyle(el).fontSize : null; })(),
      vvScale: window.visualViewport ? +window.visualViewport.scale.toFixed(3) : null,
      mq640: window.matchMedia('(max-width:640px)').matches,
    };
  });
  const readerOv = await page.evaluate(overflowProbe);
  await page.screenshot({ path: 'out/i3-reader.png' });
  console.log('READER:', JSON.stringify(reader));
  console.log('READER-OVERFLOW:', JSON.stringify(readerOv));

  // full-page shot to see total layout extent
  await page.screenshot({ path: 'out/i4-reader-full.png', fullPage: true }).catch(() => {});
  console.log('ERRS:', JSON.stringify(errs.slice(0, 10)));
  await browser.close();
})().catch(e => { console.log('FATAL:', e.message); process.exit(1); });
