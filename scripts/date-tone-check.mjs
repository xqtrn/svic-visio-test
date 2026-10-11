// Живая проверка цвета даты над кадром YouTube (Артур 2026-10-11): настоящий
// Chrome открывает страницу, ждёт, пока на карточке откроется кадр YouTube, и
// 40 секунд пишет цвет даты против шкалы с края (/svic-lum/<id>.json). Снимок
// карточки — на старте и на каждой смене цвета. Расхождение дольше полсекунды
// при открытом кадре и известной шкале = провал (код выхода 1).
// workflow: .github/workflows/date-tone-check.yml
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL_ = process.env.CHECK_URL || 'https://siliconvalleyinvestclub.com/test/';
const IDS = (process.env.CHECK_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const SECS = Number(process.env.CHECK_SECS || 40);
mkdirSync('out', { recursive: true });

// YouTube не пускает плеер с адресов дата-центров — ходим через Пингвина
// (мост HTTP→SOCKS поднимает workflow, CHECK_PROXY=http://127.0.0.1:8118)
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'],
  ...(process.env.CHECK_PROXY ? { proxy: { server: process.env.CHECK_PROXY } } : {}) });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(4000);
const ids = await page.evaluate((want) => [...document.querySelectorAll('.cs-entry__overlay')]
  .map((o) => { const w = o.querySelector('.cs-video-wrapper[data-svic-vid]'); return w && o.querySelector('.cs-meta-date') ? w.getAttribute('data-svic-vid') : null; })
  .filter((v) => v && /^[A-Za-z0-9_-]{11}$/.test(v) && (!want.length || want.includes(v))), IDS);
const pick = [...new Set(ids)].slice(0, IDS.length || 2);
console.log('карточки YouTube на странице: ' + ids.length + '; проверяю ' + pick.join(', '));
const report = [];
let failed = 0;
for (const id of pick){
  const box = page.locator(`.cs-entry__overlay:has(.cs-video-wrapper[data-svic-vid="${id}"])`).first();
  await box.scrollIntoViewIfNeeded();
  await page.evaluate((id) => { const w = document.querySelector(`.cs-video-wrapper[data-svic-vid="${id}"]`); w.closest('.cs-entry__overlay').scrollIntoView({ block: 'center' }); }, id);
  const track = await page.evaluate(async (id) => { const r = await fetch('/svic-lum/' + id + '.json'); return r.ok ? r.json() : null; }, id);
  const rows = []; let lastColor = null, shots = 0, badSince = null, bad = 0;
  for (let i = 0; i < SECS * 4; i++){
    const s = await page.evaluate((id) => {
      const o = document.querySelector(`.cs-video-wrapper[data-svic-vid="${id}"]`).closest('.cs-entry__overlay');
      const d = o.querySelector('.cs-meta-date'), h = o.querySelector('.svic-ytc');
      const e = h && h.__svicEng; let t = null; try { t = e && e.player && e.player.getCurrentTime(); } catch (x) {}
      return { op: h ? h.style.opacity : null, t, color: getComputedStyle(d).color, shadow: getComputedStyle(d).textShadow !== 'none', st: window.__svicYT && window.__svicYT.dateState ? window.__svicYT.dateState(o) : null };
    }, id);
    let expect = null;
    if (track && s.op === '1' && typeof s.t === 'number'){ const q = Math.floor(s.t * 4); let n = 0; for (const k of track.s){ if (k <= q) n++; else break; } expect = (track.d0 ^ (n & 1)) ? 'rgb(10, 23, 51)' : 'rgb(255, 255, 255)'; }
    const mismatch = expect && s.color !== expect;
    if (mismatch){ badSince = badSince ?? i; if (i - badSince >= 2) bad++; } else badSince = null;
    rows.push({ i, ...s, expect, mismatch: !!mismatch });
    if ((s.color !== lastColor || i === 0 || i === 40) && shots < 8){ await box.screenshot({ path: `out/${id}-${String(i).padStart(3, '0')}-${s.color.includes('255') ? 'white' : 'navy'}${s.op === '1' ? '-frame' : '-photo'}.png` }); shots++; }
    lastColor = s.color;
    await page.waitForTimeout(250);
  }
  const frames = rows.filter((r) => r.op === '1').length, flips = rows.filter((r, k) => k && r.color !== rows[k - 1].color).length;
  const res = { id, track: !!track, switches: track ? track.s.length : 0, samples: rows.length, frameOpen: frames, flips, mismatchSamples: bad };
  console.log(JSON.stringify(res));
  if (track && frames > 8 && bad > 0) failed++;
  report.push({ ...res, rows });
}
console.log('диагностика: ' + JSON.stringify(await page.evaluate(() => ({ yt: !!(window.YT && window.YT.Player), frames: document.querySelectorAll('.svic-ytc').length, iframes: [...document.querySelectorAll('iframe')].map((f) => f.src.slice(0, 60)).slice(0, 4), done: [...document.querySelectorAll('[data-svic-done]')].map((w) => w.getAttribute('data-svic-done')).slice(0, 6) }))));
console.log('ошибки консоли: ' + JSON.stringify([...new Set(errs)].slice(0, 8)));
writeFileSync('out/report.json', JSON.stringify(report, null, 1));
await browser.close();
process.exit(failed ? 1 : 0);
