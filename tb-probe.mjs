// tb-probe.mjs — measures the platform top bar (brand lockup vs section label)
// in real WebKit at phone width, for the live app.css plus candidate fixes.
import { webkit } from 'playwright';
import fs from 'fs';
const BASE = 'https://platform.siliconvalleyinvestclub.com';
const css = await (await fetch(BASE + '/app.css')).text();
const VARIANTS = {
  live: '',
  flexNone: '.tb-brand:not(:has(.tb-ctx)){ flex:none; }',
  aspect: '.tb-logo{ aspect-ratio:1499.9/200; }',
  logoWidth: '.tb-brand > .tb-logo{ width:157.5px; }',
  leftFix: '.tb-left:not(:has(.tb-ctx)){ flex-shrink:0; }',
};
fs.mkdirSync('out', { recursive: true });
const browser = await webkit.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 300 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const out = {};
for (const fluid of [true, false]) for (const [name, extra] of Object.entries(VARIANTS)) {
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\n${extra}</style></head>
  <body class="${fluid ? 'fluid' : ''}"><header class="topbar has-topnav"><div class="topbar-in">
  <div class="tb-left"><button class="tb-burger" aria-label="Menu"></button>
  <div class="tb-brand"><img class="tb-logo" src="${BASE}/brandbook-logo.svg" alt="Silicon Valley Investclub"></div></div>
  <div class="tb-div"></div><div class="tb-ctx">Trade Desk · Our Network</div><div class="tb-spacer"></div></div></header></body></html>`;
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => { const q = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right)]; };
    const cs = getComputedStyle(document.querySelector('.tb-brand'));
    return { brand: q('.tb-brand'), logo: q('.tb-logo'), ctx: q('.tb-ctx'), shrink: cs.flexShrink, minW: cs.minWidth, sw: document.documentElement.scrollWidth,
      hasSupported: CSS.supports('selector(:has(a))') }; });
  r.overlap = r.logo[1] > r.ctx[0];
  out[(fluid ? 'fluid-' : 'plain-') + name] = r;
  await page.screenshot({ path: `out/${fluid ? 'fluid' : 'plain'}-${name}.png`, clip: { x: 0, y: 0, width: 390, height: 70 } });
}
fs.writeFileSync('out/report.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
await browser.close();
