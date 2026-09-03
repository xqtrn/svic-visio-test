#!/usr/bin/env node
// План нарезки превью-фрагментов iv-<id>.mp4 для карточек ВСЕХ YouTube-постов сайта.
//
// До 03.09 нарезчик знал только раздел /interviews/ (22 поста первой страницы):
// остальные ~1000 YouTube-постов карточка играла либо тяжёлой полной копией
// (<id>.mp4, 5-10 МБ в бокс шириной 320-950px), либо — после 31.08 — чужим
// встроенным плеером YouTube, который на каждом старте ~4с держит поверх кадра
// свою кнопку и тёмную плёнку. Артур: карточки и превью по наведению играют НАШИ
// файлы, мгновенно, без чужого интерфейса. Значит, фрагмент нужен у каждого поста.
//
// Источник списка — публичный /__covers.json (манифест роликов сайта: v = голый
// 11-значный id у YouTube-постов). Раздел /interviews/ остаётся ДОПОЛНЕНИЕМ (пост,
// чей ролик живёт вставкой в теле, в манифест не попадает), курируемые сегменты
// iv-list.json — тоже. Порядок: сначала посты, у которых нет ВООБЩЕ ничего в
// релизах, потом те, у кого лежит только тяжёлая полная копия; внутри — свежайшие
// первыми. За прогон режется не больше BATCH роликов (лежащие и пропущенные в
// лимит не входят) — минуты Actions не бесконечны, расписание раз в 6ч само
// доберёт остаток за несколько дней.
//
// Леджер iv-covers-ledger.json (ассет релиза clips2) помнит неудачи: 38 из 55
// постов «без ничего» — это ролики, которых на YouTube больше нет (oEmbed 404/403).
// Без памяти они стояли бы в голове очереди и каждый прогон съедали бы весь лимит,
// а живые посты не дождались бы своей очереди никогда.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export const SITE = 'https://siliconvalleyinvestclub.com';
export const DEFAULT_SEG = { s: 1, e: 25 };
export const RELEASE_CAP = 1000;            // жёсткий потолок GitHub на ассеты одного релиза
export const RELEASE_RESERVE = 3;           // манифест, леджер и запас под --clobber
export const RETRY_AFTER_FAILS = 3;         // столько подряд неудач — и ролик отходит в хвост
export const RETRY_FAIL_DAYS = 7;
export const RETRY_UNAVAILABLE_DAYS = 30;   // снятый с YouTube ролик перепроверяем раз в месяц
// Релизы, которые читает воркер сайта (testnew-edge/worker.mjs: REL/REL2). Новый том
// добавлять сюда ТОЛЬКО вместе с воркером, иначе манифест обещает файл, до которого
// сайт не дотянется.
export const WORKER_RELEASES = ['clips', 'clips2'];
export const UPLOAD_RELEASE = 'clips2';

const isYt = (v) => /^[A-Za-z0-9_-]{11}$/.test(String(v || ''));
export const normPath = (u) => {
  let p = String(u || '').trim();
  if (!p) return '';
  p = p.replace(/^https?:\/\/[^/]+/, '');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
};
const dateOf = (x) => (x.d && /^\d{4}-\d{2}-\d{2}/.test(x.d)) ? x.d.slice(0, 10)
  : ((String(x.u || '').match(/^\/(20\d\d)\/(\d\d)\/(\d\d)\//) || []).slice(1, 4).join('-') || '0000-00-00');

// Манифест сайта → YouTube-посты. Записи iv-* (наши же фрагменты, подмешанные
// поверх) и самохост (mediatw6, umtk6wc6r-horizontal, cs-*) — мимо.
export function parseCovers(list) {
  const out = new Map();
  for (const x of Array.isArray(list) ? list : []) {
    if (!x || !isYt(x.v)) continue;
    const u = normPath(x.u);
    if (!u || out.has(x.v)) continue;
    out.set(x.v, { u, v: x.v, d: dateOf({ d: x.d, u }) });
  }
  return [...out.values()];
}

// Сегменты [start,end] с любой страницы, где тема ставит их на обёртку карточки
// (главная: data-svic-vid + data-video-start/end из меты статьи). 0..0 и e<=s — «не задано».
export function segMapFromHtml(html) {
  const map = {};
  // атрибуты внутри тега в любом порядке (на главной start/end стоят ПЕРЕД vid)
  const re = /<[^<>]*\bdata-svic-vid="([A-Za-z0-9_-]{11})"[^<>]*>/g;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const s = +((m[0].match(/data-video-start="(\d+)"/) || [])[1] || 0);
    const e = +((m[0].match(/data-video-end="(\d+)"/) || [])[1] || 0);
    if (e > s && !map[m[1]]) map[m[1]] = { s, e };
  }
  return map;
}

// Страница поста: id ролика и (если тема его вынесла) сегмент. Три поколения разметки:
// новый герой data-svic-yt-hero="<id>"; обёртка cs-video-wrapper data-svic-vid;
// старый блок cs-entry__media с data-(svic-vid|video-id) (в т.ч. full-<id> — полный
// самохост интервью, карточке всё равно нужен фрагмент); в крайнем случае embed-ссылка.
export function parsePostPage(html) {
  const h = String(html || '');
  let vid = (h.match(/data-svic-yt-hero="([A-Za-z0-9_-]{11})"/) || [])[1];
  let seg = null;
  const wrap = h.match(/<div class="cs-video-wrapper"[^>]*>/);
  if (wrap) {
    const w = wrap[0];
    if (!vid) vid = (w.match(/data-svic-vid="([A-Za-z0-9_-]{11})"/) || [])[1];
    const s = +((w.match(/data-video-start="(\d+)"/) || [])[1] || 0);
    const e = +((w.match(/data-video-end="(\d+)"/) || [])[1] || 0);
    if (e > s) seg = { s, e };
  }
  const mi = h.indexOf('<div class="cs-entry__media');
  if (mi >= 0) {
    const block = h.slice(mi, mi + 3000);
    if (!vid) vid = (block.match(/data-(?:svic-vid|video-id)="(?:full-)?([A-Za-z0-9_-]{11})"/) || [])[1];
    if (!vid && (block.match(/data-(?:svic-vid|video-id)="([A-Za-z0-9_-]+)"/) || [])[1]) return { vid: null, seg: null, selfHosted: true };
    const s = +((block.match(/data-video-start="(\d+)"/) || [])[1] || 0);
    const e = +((block.match(/data-video-end="(\d+)"/) || [])[1] || 0);
    if (!seg && e > s) seg = { s, e };
  }
  if (!vid) vid = (h.match(/youtube\.com\/(?:embed\/|watch\?v=)([A-Za-z0-9_-]{11})/) || [])[1];
  return { vid: vid || null, seg, selfHosted: false };
}

export const postLinks = (html) => [...new Set([...String(html || '').matchAll(/href="(?:https?:\/\/[^"/]+)?(\/20\d\d\/\d\d\/\d\d\/[a-z0-9-]+)\/?"/g)].map((m) => m[1]))];

const daysSince = (iso, now) => (iso ? (now - Date.parse(iso)) / 86400000 : Infinity);

// Раскладка постов по тому, что уже лежит в релизах и что помнит леджер.
//   haveIv    — фрагмент лежит (и не признан немым) → пропуск
//   have480   — облегчённая копия лежит, карточка играет её → пропуск
//   deferred  — ролик подряд не качается / снят с YouTube → отдыхает до срока
//   candidates — по порядку: без ничего → только полная копия; свежие первыми
export function classify(posts, assets, ledger = {}, now = Date.now()) {
  const have = assets instanceof Set ? assets : new Set(assets);
  const out = { haveIv: [], have480: [], deferred: [], candidates: [] };
  for (const p of posts) {
    const L = ledger[p.v] || {};
    if (have.has(`iv-${p.v}.mp4`) && L.audio !== false) { out.haveIv.push(p); continue; }
    if (have.has(`${p.v}.480.mp4`)) { out.have480.push(p); continue; }
    if (L.unavailable && daysSince(L.unavailable, now) < RETRY_UNAVAILABLE_DAYS) { out.deferred.push({ ...p, why: 'unavailable' }); continue; }
    if ((L.fails || 0) >= RETRY_AFTER_FAILS && daysSince(L.last, now) < RETRY_FAIL_DAYS) { out.deferred.push({ ...p, why: 'fails' }); continue; }
    const why = L.audio === false ? 'silent' : have.has(`${p.v}.mp4`) ? 'full' : 'none';
    out.candidates.push({ ...p, why });
  }
  const rank = { silent: 0, none: 0, full: 1 };
  out.candidates.sort((a, b) => (rank[a.why] - rank[b.why]) || b.d.localeCompare(a.d) || a.v.localeCompare(b.v));
  return out;
}

// Отбор партии: oEmbed YouTube отвечает 4xx только на ролик, которого для нас нет
// (404 удалён, 403 приватный — yt-dlp просит войти, 400 — в манифест попал не id,
// а обрывок имени канала: «BessemerVen»). Такой пропускаем без yt-dlp и запоминаем
// на месяц; иначе 38 мёртвых из 55 постов «без ничего» съедали бы лимит каждый прогон.
export async function pickBatch(candidates, batch, probe, ledger, now = Date.now()) {
  const picked = [];
  const unavailable = [];
  for (const c of candidates) {
    if (picked.length >= batch) break;
    let code = 200;
    try { code = await probe(c.v); } catch { code = 0; }
    if (code >= 400 && code < 500) {
      unavailable.push(c);
      ledger[c.v] = { ...(ledger[c.v] || {}), unavailable: new Date(now).toISOString() };
      continue;
    }
    picked.push(c);
  }
  return { picked, unavailable };
}

export function resolveSegment(vid, { home = {}, page = null, curated = {} } = {}) {
  const pick = home[vid] || page || curated[vid] || DEFAULT_SEG;
  const s = Math.max(0, +pick.s || 0);
  const e = +pick.e > s ? +pick.e : s + 24;
  return { s, e };
}

// Манифест для воркера: {u, v:'iv-<id>'} у КАЖДОГО поста, чей фрагмент реально лежит
// в релизе, который воркер читает. Имя файла interview-covers.json воркер зашил.
export function buildManifest(posts, workerAssets) {
  const have = workerAssets instanceof Set ? workerAssets : new Set(workerAssets);
  const seen = new Set();
  const out = [];
  for (const p of posts) {
    if (!isYt(p.v) || seen.has(p.v) || !have.has(`iv-${p.v}.mp4`)) continue;
    seen.add(p.v);
    out.push({ u: normPath(p.u), v: `iv-${p.v}` });
  }
  return out;
}

export function noteResult(ledger, vid, outcome, reason = '', now = Date.now()) {
  const L = { ...(ledger[vid] || {}) };
  if (outcome === 'ok') { delete L.fails; delete L.last; delete L.reason; delete L.unavailable; L.audio = true; L.cut = new Date(now).toISOString(); }
  else { L.fails = (L.fails || 0) + 1; L.last = new Date(now).toISOString(); L.reason = String(reason || '').slice(0, 200); }
  ledger[vid] = L;
  return ledger;
}

// ---------------- CLI ----------------
const readJson = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return dflt; } };
const readLines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean); } catch { return []; } };
const UA = { 'User-Agent': 'Mozilla/5.0 (iv-covers; +https://github.com/xqtrn/svic-visio-test)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, tries = 1) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: UA, redirect: 'follow' });
      if (r.ok) return await r.text();
      console.error(`${url}: HTTP ${r.status}`);
    } catch (e) { console.error(`${url}: ${e.message}`); }
    if (i < tries) await sleep(i * 20000);
  }
  return '';
}

async function oembed(vid) {
  const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${vid}&format=json`, { headers: UA });
  return r.status;
}

// Звук в уже лежащем фрагменте (2026-08-04: кнопка unmute включала тишину).
// Проверяется один раз — вердикт остаётся в леджере.
function probeAudio(repo, vid) {
  for (const tag of ['clips2', 'clips']) {
    const url = `https://github.com/${repo}/releases/download/${tag}/iv-${vid}.mp4`;
    try {
      const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', url], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] });
      if (out.trim()) return true;
    } catch { /* нет дорожки или файла в этом томе — пробуем следующий */ }
  }
  return false;
}

async function cmdPlan() {
  const { openTask, closeTask } = await import('./system-task.mjs');
  const batch = Math.max(0, +(process.env.BATCH || 25) || 0);
  const repo = process.env.GITHUB_REPOSITORY || 'xqtrn/svic-visio-test';
  const assets = new Set([...readLines('existing-clips.txt'), ...readLines('existing-clips2.txt')]);
  const clips2Count = readLines('existing-clips2.txt').length;
  const ledger = readJson('iv-covers-ledger.json', {});
  const curatedList = readJson('iv-list.json', []);
  const curated = Object.fromEntries(curatedList.map((x) => [x.v, { s: x.s, e: x.e }]));

  // 1) манифест сайта — источник истины по всем YouTube-постам. Пустая выдача
  //    после четырёх попыток — поломка с карточкой, не тихий откат (2026-08-03).
  let posts = [];
  for (let attempt = 1; attempt <= 4 && !posts.length; attempt++) {
    const txt = await fetchText(`${SITE}/__covers.json?_cb=${Date.now()}`);
    try { posts = parseCovers(JSON.parse(txt)); } catch { posts = []; }
    if (!posts.length) { console.error(`попытка ${attempt}: манифест без YouTube-постов, жду и повторяю`); await sleep(attempt * 20000); }
  }
  if (!posts.length) {
    await openTask({
      key: 'iv-covers-list-empty',
      summary: 'Нарезка превью для карточек не видит список роликов сайта',
      details: `Воркфлоу iv-covers: ${SITE}/__covers.json не дал ни одного YouTube-поста. Пока это так, свежие статьи выходят на карточки без нашего фрагмента.`,
      instructions: 'Проверить, отдаёт ли публичный сайт /__covers.json (манифест роликов), и перезапустить воркфлоу iv-covers в xqtrn/svic-visio-test.',
    });
    console.error('FATAL: манифест сайта не дал ни одного YouTube-поста');
    process.exit(1);
  }
  await closeTask('iv-covers-list-empty', 'манифест снова отдаёт список');
  const byV = new Map(posts.map((p) => [p.v, p]));
  const byU = new Set(posts.map((p) => p.u));

  // 2) раздел /interviews/ — дополнение: пост с роликом-вставкой в теле в манифест не входит
  const ivHtml = await fetchText(`${SITE}/interviews/?_cb=${Date.now()}`, 2);
  let extra = 0;
  for (const u of postLinks(ivHtml)) {
    if (byU.has(u)) continue;
    const { vid } = parsePostPage(await fetchText(`${SITE}${u}/`));
    if (vid && !byV.has(vid)) { const p = { u, v: vid, d: dateOf({ u }) }; posts.push(p); byV.set(vid, p); byU.add(u); extra++; }
  }
  // курируемые записи, чьих постов нигде нет, — тоже в список
  for (const c of curatedList) if (isYt(c.v) && !byV.has(c.v)) { const p = { u: normPath(c.u), v: c.v, d: dateOf({ u: c.u }) }; posts.push(p); byV.set(c.v, p); extra++; }
  console.error(`постов с YouTube-роликом: ${posts.length} (манифест ${posts.length - extra} + раздел/курируемые ${extra})`);

  // 3) немой фрагмент считается отсутствующим — проверяем по одному разу
  for (const p of posts) {
    if (!assets.has(`iv-${p.v}.mp4`)) continue;
    const L = ledger[p.v] || {};
    if (typeof L.audio === 'boolean') continue;
    ledger[p.v] = { ...L, audio: probeAudio(repo, p.v) };
    if (!ledger[p.v].audio) console.error(`в релизе лежит немой фрагмент iv-${p.v} — пересоберу со звуком`);
  }

  const cls = classify(posts, assets, ledger);
  const room = RELEASE_CAP - clips2Count - RELEASE_RESERVE;
  const stats = { posts: posts.length, have_iv: cls.haveIv.length, have_480: cls.have480.length, deferred: cls.deferred.length, backlog: cls.candidates.length, release_room: room, release_full: false, batch, picked: 0, unavailable: 0 };
  let picked = [];
  if (room < 1) {
    stats.release_full = true;
    console.error(`FATAL-класс: релиз ${UPLOAD_RELEASE} на потолке GitHub (${clips2Count} из ${RELEASE_CAP}) — резать некуда`);
  } else {
    const r = await pickBatch(cls.candidates, Math.min(batch, room), oembed, ledger);
    picked = r.picked; stats.picked = picked.length; stats.unavailable = r.unavailable.length;
    for (const c of r.unavailable) console.error(`ролика больше нет на YouTube: ${c.v} ${c.u}`);
  }

  // 4) сегменты: главная (мета статьи) > страница поста > курируемые > 1..25
  const home = segMapFromHtml(await fetchText(`${SITE}/?_cb=${Date.now()}`, 2));
  for (const c of picked) {
    let page = null;
    if (!home[c.v] && !curated[c.v]) page = parsePostPage(await fetchText(`${SITE}${c.u}/`)).seg;
    Object.assign(c, resolveSegment(c.v, { home, page, curated }));
  }

  fs.writeFileSync('iv-dynamic.json', JSON.stringify(picked));
  fs.writeFileSync('iv-plan.txt', picked.map((c) => [c.v, c.s, c.e, c.why, c.u].join('\t')).join('\n') + (picked.length ? '\n' : ''));
  fs.writeFileSync('iv-all.json', JSON.stringify(posts.map((p) => ({ u: p.u, v: p.v, d: p.d }))));
  fs.writeFileSync('iv-covers-ledger.json', JSON.stringify(ledger));
  fs.writeFileSync('iv-stats.json', JSON.stringify(stats));
  console.error('итог:', JSON.stringify(stats));
  for (const c of picked) console.error(' ', c.v, `[${c.s}..${c.e}]`, c.why, c.d, c.u.slice(0, 70));
}

function cmdNote([vid, outcome, ...reason]) {
  const ledger = readJson('iv-covers-ledger.json', {});
  noteResult(ledger, vid, outcome, reason.join(' '));
  fs.writeFileSync('iv-covers-ledger.json', JSON.stringify(ledger));
}

function cmdManifest() {
  const posts = readJson('iv-all.json', []);
  const workerAssets = new Set(WORKER_RELEASES.flatMap((t) => readLines(`existing-${t}.txt`)));
  const manifest = buildManifest(posts, workerAssets);
  fs.writeFileSync('interview-covers.json', JSON.stringify(manifest));
  console.error('манифест:', manifest.length);
}

async function cmdReport([ok, fail]) {
  const { openTask, closeTask } = await import('./system-task.mjs');
  const stats = readJson('iv-stats.json', {});
  const OK = +ok || 0, FAIL = +fail || 0, tried = OK + FAIL;
  const summary = `нарезано ${OK}, не удалось ${FAIL} из ${tried}; уже лежит ${stats.have_iv || 0}, играет .480 ${stats.have_480 || 0}, снято с YouTube ${stats.unavailable || 0}, отложено ${stats.deferred || 0}, в очереди ${Math.max(0, (stats.backlog || 0) - tried)}`;
  console.log(`=== ${summary} ===`);
  if (stats.release_full) {
    await openTask({
      key: 'iv-covers-release-full',
      summary: 'Склад превью-фрагментов заполнен — новые карточки остаются без нашего ролика',
      details: `Релиз ${UPLOAD_RELEASE} в xqtrn/svic-visio-test упёрся в потолок GitHub (${RELEASE_CAP} файлов). Нарезка остановлена, чтобы не класть файлы туда, откуда сайт их не прочтёт.`,
      instructions: 'Завести релиз clips3, научить воркер сайта (testnew-edge/worker.mjs, REL/REL2) и WORKER_RELEASES/UPLOAD_RELEASE в scripts/iv-covers-plan.mjs читать и писать новый том.',
    });
  } else await closeTask('iv-covers-release-full', 'в релизе снова есть место');
  const bad = tried >= 2 && FAIL / tried > 0.5;
  if (bad) {
    await openTask({
      key: 'iv-covers-yt-failures',
      summary: 'Нарезка превью для карточек не может скачать ролики с YouTube',
      details: `Воркфлоу iv-covers: за прогон не удалось ${FAIL} из ${tried} роликов. Обычно это значит, что YouTube перестал отдавать видео через наш прокси (PENGUIN_SOCKS) или yt-dlp отстал от YouTube.`,
      instructions: 'Открыть лог последнего прогона iv-covers в xqtrn/svic-visio-test, посмотреть причину в строках «не удалось», проверить прокси Пингвина и версию yt-dlp, перезапустить прогон.',
    });
  } else if (tried) await closeTask('iv-covers-yt-failures', 'ролики снова качаются');
  process.exit(bad ? 1 : 0);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'plan') cmdPlan().catch((e) => { console.error('FATAL', e); process.exit(1); });
else if (cmd === 'note') cmdNote(args);
else if (cmd === 'manifest') cmdManifest();
else if (cmd === 'report') cmdReport(args).catch((e) => { console.error('FATAL', e); process.exit(1); });
else if (cmd) { console.error('usage: iv-covers-plan.mjs plan|note <id> ok|fail [reason]|manifest|report <ok> <fail>'); process.exit(2); }
