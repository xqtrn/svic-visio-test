// Сценарий настоящего WebKit с профилем iPhone: ролик главной идёт при открытии,
// после перехода в статью и «назад», и пауза кнопкой держится.
import { webkit, devices } from 'playwright';
import fs from 'node:fs';
const BASE = (process.env.BASE || 'https://siliconvalleyinvestclub.com').replace(/\/$/, '');
fs.mkdirSync('out', { recursive: true });
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 15'] });
const page = await ctx.newPage();
const report = { steps: [], errors: [] };
page.on('pageerror', (e) => report.errors.push(String(e).slice(0, 300)));
const sample = () => page.evaluate(async () => {
  const ratio = (v) => { const r = v.getBoundingClientRect(); if (r.height <= 0) return 0;
    return Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / r.height; };
  const vs = [...document.querySelectorAll('video')];
  const before = vs.map((v) => v.currentTime);
  await new Promise((r) => setTimeout(r, 4000));
  return { guard: !!window.__svicVideoLiveness, count: vs.length,
    videos: vs.map((v, i) => ({ i, visible: Math.round(ratio(v) * 100) / 100, paused: v.paused, rs: v.readyState,
      moved: Math.round((v.currentTime - before[i]) * 10) / 10, user: v.dataset.svicUserPaused || '' })).filter((x) => x.visible > 0) };
});
const save = () => fs.writeFileSync('out/report.json', JSON.stringify(report, null, 1));
const log = (m) => console.log(new Date().toISOString().slice(11, 19), m);
const limit = (p, ms, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout: ' + what)), ms))]);
const step = async (name) => { log('sample ' + name); const s = await limit(sample(), 30000, 'sample ' + name);
  report.steps.push({ name, url: page.url(), ...s }); save(); log(JSON.stringify(s));
  await limit(page.screenshot({ path: `out/${name}.png`, timeout: 15000 }), 20000, 'shot').catch((e) => log('no screenshot: ' + e.message)); };
log('open'); await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 60000 });
await page.waitForTimeout(9000);
await step('1-open');
const href = await page.evaluate(() => { const v = [...document.querySelectorAll('video')][0];
  let n = v; for (let i = 0; n && i < 8; i++, n = n.parentElement) { const a = n.querySelector && n.querySelector('a[href*="/20"]'); if (a) return a.href; } return null; });
report.href = href;
if (href) {
  log('go to article ' + href); await limit(page.evaluate((h) => { const a = [...document.querySelectorAll('a[href]')].find((x) => x.href === h); setTimeout(() => a.click(), 50); }, href), 15000, 'click');
  await page.waitForTimeout(9000);
  report.article = page.url();
  log('back from ' + report.article); await limit(page.goBack({ waitUntil: 'commit', timeout: 30000 }), 35000, 'back');
  await page.waitForTimeout(6000);
  await step('2-after-back');
  await page.evaluate(() => scrollBy(0, 700)); await page.waitForTimeout(3000);
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(4000);
  await step('3-after-scroll');
}
save(); log('done'); await limit(browser.close(), 10000, 'close').catch(() => {}); process.exit(0);
