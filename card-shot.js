// card-shot.js — скрины карточки компании стенда: desktop-верх, полная, mobile.
// Запасной облачный визиотестер: когда CF Browser Rendering в дневном лимите.
const { chromium } = require('playwright');
(async () => {
  const url = process.env.SHOT_URL || 'https://test.siliconvalleyinvestclub.com/corgi-insurance/test?__static=1';
  const fs = require('fs'); fs.mkdirSync('out', { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies([{ name: 'svic_token', value: 'edge-preview', domain: 'test.siliconvalleyinvestclub.com', path: '/' }]);
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000); // settle-пауза: дожёвывающие DOM скрипты
  // клик-визиотест (fallback, когда CF Browser Rendering в лимите):
  // видимость computed-стилями, Load more, фильтры всех режимов, сортировка,
  // контрол на каждом столбце, видео-фасад
  const probe = await page.evaluate(async () => {
    const vis = (sel) => [...document.querySelectorAll(sel)].filter((e) => getComputedStyle(e).display !== 'none').length;
    const out = {};
    out.colw = [...document.querySelectorAll('#funding th')].map((t) => Math.round(t.getBoundingClientRect().width));
    out.tw = Math.round((document.querySelector('#funding table') || {getBoundingClientRect(){return {width:0}}}).getBoundingClientRect().width);
    out.bodyw = Math.round((document.querySelector('#funding') || {getBoundingClientRect(){return {width:0}}}).getBoundingClientRect().width);
    out.leak = [...document.querySelectorAll('[hidden]')].filter((e) => getComputedStyle(e).display !== 'none').length;
    out.thNoCtl = [...document.querySelectorAll('table th')].filter((t) => !t.hasAttribute('data-k') && !t.hasAttribute('data-f')).length;
    out.preNews = vis('#news [data-lm] > *'); out.preInv = vis('#investors [data-lm] > *');
    [...document.querySelectorAll('button')].filter((b) => /^(Load more|\+\d+ more)/.test(b.textContent.trim())).forEach((b) => b.click());
    await new Promise((r) => setTimeout(r, 600));
    out.postNews = vis('#news [data-lm] > *'); out.postInv = vis('#investors [data-lm] > *');
    const clickFilter = async (thSel, valRe) => {
      const th = document.querySelector(thSel); if (!th) return 'no-th';
      th.click(); await new Promise((r) => setTimeout(r, 200));
      const dd = th.querySelector('[data-fdd]'); if (!dd) return 'no-dd';
      const btn = [...dd.querySelectorAll('button')].find((b) => valRe.test(b.textContent)); if (!btn) return 'no-opt';
      btn.click(); await new Promise((r) => setTimeout(r, 200));
      return 'ok';
    };
    out.fRound = await clickFilter('#funding th[data-fa]', /^Series B1/);
    out.roundVisible = vis('#funding tbody tr');
    out.fInv = await clickFilter('#funding th[data-fl]', /^TCV \(/);
    out.invRoundsVisible = vis('#funding tbody tr');
    const th = document.querySelector('#investors th[data-k="n"]');
    const first = () => document.querySelector('#investors tbody tr') && document.querySelector('#investors tbody tr').getAttribute('data-n');
    const b4 = first(); if (th) th.click(); await new Promise((r) => setTimeout(r, 200));
    out.sortChanged = first() !== b4;
    const v = document.querySelector('[data-embed]'); out.hasVideo = !!v;
    if (v){ v.click(); await new Promise((r) => setTimeout(r, 500)); out.video = !!v.querySelector('iframe'); }
    return out;
  });
  fs.writeFileSync('out/probe.json', JSON.stringify(probe, null, 1));
  console.log('probe:', JSON.stringify(probe));
  const bad = probe.leak || probe.thNoCtl || !(probe.postNews > probe.preNews) || !(probe.postInv > probe.preInv)
    || probe.fRound !== 'ok' || probe.roundVisible !== 1 || probe.fInv !== 'ok' || !probe.sortChanged || (probe.hasVideo && !probe.video);
  if (bad){ console.error('CLICK-PROBE FAILED'); process.exitCode = 1; }
  // скрины — чистого дефолтного вида: перезагрузка после клик-пробы
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'out/card-desktop-top.png' });
  await page.screenshot({ path: 'out/card-full.png', fullPage: true });
  const mob = await ctx.newPage(); await mob.setViewportSize({ width: 390, height: 844 });
  await mob.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await mob.waitForTimeout(3000);
  await mob.screenshot({ path: 'out/card-mobile.png', fullPage: true });
  await browser.close();
  console.log('shots done');
})().catch((e) => { console.error(e); process.exit(1); });
