// card-shot.js — скрины карточки компании стенда: desktop-верх, полная, mobile.
// Запасной облачный визиотестер: когда CF Browser Rendering в дневном лимите.
const { chromium } = require('playwright');
(async () => {
  const url = process.env.SHOT_URL || 'https://test.siliconvalleyinvestclub.com/companies/corgi-insurance/?__static=1';
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
    out.hscroll = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (out.hscroll > 0){
      const vw = document.documentElement.clientWidth;
      out.offenders = [...document.querySelectorAll('body *')]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1); })
        .slice(0, 6).map((e) => e.tagName + '.' + String(e.className).slice(0, 40) + ' r=' + Math.round(e.getBoundingClientRect().right));
    }
    out.leak = [...document.querySelectorAll('[hidden]')].filter((e) => getComputedStyle(e).display !== 'none').length;
    out.thNoCtl = [...document.querySelectorAll('table th')].filter((t) => !t.hasAttribute('data-k') && !t.hasAttribute('data-f')).length;
    out.preNews = vis('#news [data-lm] > *'); out.preInv = vis('#investors [data-lm] > *');
    [...document.querySelectorAll('button')].filter((b) => /^(Load more|\+\d+ more)/.test(b.textContent.trim())).forEach((b) => b.click());
    await new Promise((r) => setTimeout(r, 600));
    out.postNews = vis('#news [data-lm] > *'); out.postInv = vis('#investors [data-lm] > *');
    const clickFilter = async (thSel, valRe) => {
      const th = document.querySelector(thSel); if (!th) return 'no-th';
      th.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 300));
      th.click(); await new Promise((r) => setTimeout(r, 200));
      const dd = document.querySelector('[data-fdd]'); if (!dd) return 'no-dd';
      const b0 = dd.querySelector('button'); const br = b0.getBoundingClientRect();
      const hit = document.elementFromPoint(br.left + br.width / 2, br.top + Math.min(br.height / 2, 12));
      if (!(hit === b0 || b0.contains(hit) || dd.contains(hit))) return 'dd-not-visible';
      let btn = [...dd.querySelectorAll('button')].find((b) => valRe.test(b.textContent));
      if (!btn) btn = [...dd.querySelectorAll('button')].find((b) => !/^All \(/.test(b.textContent.trim())); // любая конкретная опция
      if (!btn) return 'no-opt';
      btn.click(); await new Promise((r) => setTimeout(r, 200));
      return 'ok';
    };
    const totalRounds = vis('#funding tbody tr');
    out.fRound = await clickFilter('#funding th[data-fa]', /^Series B1/);
    out.roundVisible = vis('#funding tbody tr');
    out.fRoundOk = out.fRound === 'ok' && out.roundVisible >= 1 && out.roundVisible <= totalRounds;
    out.fInv = await clickFilter('#funding th[data-fl]', /^TCV \(/);
    out.invRoundsVisible = vis('#funding tbody tr');
    out.fInvOk = out.fInv === 'ok' && out.invRoundsVisible >= 1;
    const th = document.querySelector('#investors th[data-k="n"]');
    const first = () => document.querySelector('#investors tbody tr') && document.querySelector('#investors tbody tr').getAttribute('data-n');
    const b4 = first();
    if (th){ th.click(); await new Promise((r) => setTimeout(r, 200));
      if (first() === b4){ th.click(); await new Promise((r) => setTimeout(r, 200)); } } // порядок мог совпасть — второй клик обязан сменить
    out.sortChanged = first() !== b4;
    /* серые зоны запрещены: в полосе KPI и в рядах лид-карточек все ячейки
       ряда равной ширины (Артур 2026-08-02: «не оставляй серых зон») */
    const eq = (els) => { const w = els.map((e) => e.getBoundingClientRect().width); return !w.length || (Math.max(...w) - Math.min(...w)) < 3; };
    const kpiCells = [...(document.getElementById('kpi') || { children: [] }).children];
    out.kpiCells = kpiCells.length; out.kpiEqual = eq(kpiCells);
    const leadRows = [...(document.getElementById('leads') || { children: [] }).children];
    out.leadRows = leadRows.map((r) => r.children.length).join('+');
    out.leadsEqual = leadRows.every((r) => eq([...r.children]));
    const counts = leadRows.map((r) => r.children.length);
    out.leadsBalanced = counts.length < 2 || (Math.max(...counts) - Math.min(...counts)) <= 1;
    const v = document.querySelector('[data-embed]'); out.hasVideo = !!v;
    if (v){ v.click(); await new Promise((r) => setTimeout(r, 500)); out.video = !!v.querySelector('iframe'); }
    return out;
  });
  fs.writeFileSync('out/probe.json', JSON.stringify(probe, null, 1));
  console.log('probe:', JSON.stringify(probe));
  const bad = probe.leak || probe.thNoCtl
    || (probe.kpiCells > 0 && !probe.kpiEqual) || probe.leadsEqual === false || probe.leadsBalanced === false
    || (probe.preNews > 0 && !(probe.postNews > probe.preNews)) // лента есть → Load more обязан работать
    || !(probe.postInv > probe.preInv)
    || !probe.fRoundOk || !probe.fInvOk || !probe.sortChanged || (probe.hasVideo && !probe.video);
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
