// date-lum.mjs — шкала яркости угла даты для карточек, где играет плеер YouTube.
//
// Зачем (Артур 2026-10-11, «цвет должен меняться»): дата в правом верхнем углу
// видео-карточки перекрашивается в белую/тёмно-синюю по яркости кадра под ней.
// До 03.09 сайт читал кадр своего ролика прямо в браузере; с 03.09 в карточках
// играет плеер YouTube, а его кадр браузер сайту читать не даёт — дата застывала
// в цвете, посчитанном по заставке (Morpho: тёмная дата на чёрном кадре).
// Теперь яркость того же угла считается здесь, заранее, по нашей копии ролика —
// 4 замера в секунду, — а страница берёт замер по текущему времени плеера.
// Длительность и файл YouTube берём клиентами ios/android/tv_embedded, если
// web упёрся в бот-стену (карточка b1851043, 11 дыр: yt-info / no-source / error).
// С 17.10 этого мало: все клиенты, включая android/ios/tv, отвечают
// «confirm you’re not a bot», пока yt-dlp не решает JS-задачу YouTube и не
// чеканит PO-token. На раннере стоит Node 22, Deno нет; без --js-runtimes node
// экстрактор молча идёт без EJS — Пингвин живой, ответ всё равно бот-стена
// (карточка f4fed8bd, 10 дыр yt-info).
//
// ХРОНОМЕТРАЖ (Артур: «точно не будет путаницы?»): копия обязана быть ТЕМ ЖЕ
// роликом, что на YouTube. У интервью <id>.mp4 — 24-секундная нарезка, ролик
// бывает перезалит или обрезан иначе. Поэтому шкала публикуется только если
// (1) длительность копии совпала с длительностью на YouTube и (2) яркость угла
// по копии совпала с яркостью того же угла на кадрах-миниатюрах самого YouTube
// (полоса перемотки, кадр раз в несколько секунд) без сдвига во времени.
// Не совпало — шкалы нет, страница держит дату белой с тенью.
//
// Зона и формула — ровно те, что у сэмплера страницы (testnew-edge/chrome.mjs в
// svic-platform): x от 58% ширины, ширина 42%, высота 26% от верха, яркость
// 0.299R+0.587G+0.114B, кадр вписан в 16:9 с чёрными полями, как его рисует
// плеер YouTube в карточке.
//
// Что едет на сайт — не сама яркость, а МОМЕНТЫ СМЕНЫ ЦВЕТА с тем же запасом
// (гистерезисом), что у сэмплера страницы: {d0: цвет с первого кадра, s: номера
// четвертей секунды, где цвет меняется}. Карта всех роликов — один ассет
// date-lum.json в релизе date-lum; край сайта отдаёт строку ролика по
// /svic-lum/<id>.json (testnew-edge/worker.mjs в svic-platform).
//
// CLI (workflow .github/workflows/date-lum.yml):
//   plan  <covers.json> <map.json> <assets.txt> <shards> <outdir>  → shards.json + plan-<k>.tsv
//   run   <plan.tsv> <outdir> [budget-sec]                           → <outdir>/<id>.json
//   merge <map.json> <results-dir>                                    → map.json на месте + отчёт
//   watch <covers.json> <map.json>                                    → карточка Development при дыре
//   track <video.mp4> <yt-info.json>                                  → разовая проверка одного файла
// Чистые функции экспортируются для юнит-тестов (scripts/date-lum.test.mjs).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const RATE = 4;                 // замеров в секунду
export const ZONE = { x: 0.58, w: 0.42, h: 0.26 };
export const GRID = { w: 24, h: 10 };  // та же сетка 24x10, что у сэмплера страницы
export const DUR_TOL = 1.5;            // с — допуск длительности копии к YouTube
export const MAX_SHIFT = 0.75;         // с — сдвиг начала копии к миниатюрам не дальше
export const MAD_TIE = 1;              // подгонки в пределах этой разницы считаются равными
export const SHIFT_SEARCH = 4;         // с — где ищем сдвиг (шире допуска: иначе чужой сдвиг не виден)
export const MAD_MAX = 10;             // средняя разница яркости копия↔миниатюры
export const AGREE_MIN = 0.9;          // доля совпавших решений «светлый/тёмный»
export const MIN_POINTS = 4;           // меньше миниатюр — сверять не по чему

export function lumaRGB(buf, off, n){
  let a = 0;
  for (let i = 0; i < n; i++){ const p = off + i * 3; a += 0.299 * buf[p] + 0.587 * buf[p + 1] + 0.114 * buf[p + 2]; }
  return a / n;
}

// Фильтр ffmpeg: кадр → 16:9 с полями (как в плеере) → угол даты → сетка 24x10.
export function zoneFilter(prefix = ''){
  const W = 640, H = 360;
  return prefix +
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,` +
    `crop=${Math.ceil(W * ZONE.w)}:${Math.ceil(H * ZONE.h)}:${Math.floor(W * ZONE.x)}:0,` +
    `scale=${GRID.w}:${GRID.h}:flags=area,format=rgb24`;
}

function ffmpegRaw(args){
  const r = spawnSync('ffmpeg', ['-v', 'error', ...args, '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error('ffmpeg: ' + String(r.stderr || '').slice(0, 300));
  return r.stdout;
}

export function probeDuration(file){
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const d = parseFloat(String(r.stdout || '').trim());
  return Number.isFinite(d) ? d : 0;
}

// Шкала по копии: Uint8Array, элемент i — яркость угла в момент i/RATE секунд.
export function trackFromVideo(file){
  const raw = ffmpegRaw(['-i', file, '-an', '-vf', zoneFilter(`fps=${RATE},`)]);
  const fb = GRID.w * GRID.h * 3, n = Math.floor(raw.length / fb);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(lumaRGB(raw, i * fb, GRID.w * GRID.h));
  return out;
}

// Миниатюры полосы перемотки YouTube (формат storyboard из yt-dlp -J): каждый
// лист — сетка columns×rows кадров, кадр k всего ролика стоит в момент k/fps.
// Возвращает [{t, L}] — яркость того же угла на каждой миниатюре.
export function pickStoryboard(info){
  const sb = (info.formats || []).filter((f) => f.format_note === 'storyboard' && Array.isArray(f.fragments) && f.fragments.length && f.fps > 0 && f.rows && f.columns);
  // самая детальная сетка: крупнее кадр — точнее угол
  sb.sort((a, b) => (b.width * b.height) - (a.width * a.height));
  return sb[0] || null;
}

export async function storyboardLum(sb, fetchImpl = fetch){
  const pts = [];
  const per = sb.rows * sb.columns, step = 1 / sb.fps;
  let k = 0;
  for (const fr of sb.fragments){
    const res = await fetchImpl(fr.url);
    if (!res.ok) throw new Error('storyboard ' + res.status);
    const jpg = Buffer.from(await res.arrayBuffer());
    // лист целиком в rgb24 нужного размера: тайлы режем сами
    const r = spawnSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-vf', `scale=${sb.columns * sb.width}:${sb.rows * sb.height}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { input: jpg, maxBuffer: 1 << 28 });
    if (r.status !== 0) throw new Error('ffmpeg sheet: ' + String(r.stderr).slice(0, 200));
    const sheet = r.stdout, sw = sb.columns * sb.width;
    const fragFrames = Math.min(per, Math.round((fr.duration || per * step) / step));
    for (let i = 0; i < fragFrames; i++, k++){
      const col = i % sb.columns, row = Math.floor(i / sb.columns);
      const tile = tileRGB(sheet, sw, col * sb.width, row * sb.height, sb.width, sb.height);
      const L = zoneLumOfTile(tile, sb.width, sb.height);
      if (L >= 0) pts.push({ t: k * step, L });
    }
  }
  return pts;
}

function tileRGB(sheet, sw, x0, y0, w, h){
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) sheet.copy(out, y * w * 3, ((y0 + y) * sw + x0) * 3, ((y0 + y) * sw + x0 + w) * 3);
  return out;
}

// Тот же угол на миниатюре: миниатюра уже вписана YouTube в свою рамку; ведём
// её через тот же фильтр, что и копию, — поля и зона считаются одинаково.
export function zoneLumOfTile(tile, w, h){
  const r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, '-i', 'pipe:0', '-vf', zoneFilter(), '-f', 'rawvideo', 'pipe:1'], { input: tile, maxBuffer: 1 << 20 });
  if (r.status !== 0 || r.stdout.length < GRID.w * GRID.h * 3) return -1;
  return lumaRGB(r.stdout, 0, GRID.w * GRID.h);
}

const dark = (L) => L > 138;

// Сверка шкалы копии с миниатюрами YouTube. Возвращает вердикт и цифры —
// они пишутся в отчёт прогона, чтобы отказ был виден, а не тих.
//
// ШАГ МИНИАТЮР: yt-dlp считает его как длительность / число кадров (у Morpho
// 4.897с), а YouTube ставит миниатюры с круглым шагом из своей спецификации
// (там 5.000с, замер 2026-10-11: на 4.897 разница копия↔YouTube 22 единицы
// яркости, на 5.000 — 3.8). Поэтому шаг подбирается в коридоре вокруг
// номинала, а сдвиг начала держится узким: у ТОГО ЖЕ ролика он около нуля,
// у копии с лишним вступлением или обрезанной — уезжает, и сверка отказывает.
export function verify({ track, points, copyDur, ytDur }){
  const out = { ok: false, reason: '', copyDur: +copyDur.toFixed(2), ytDur, points: points.length };
  if (!(ytDur > 0)) { out.reason = 'no-yt-duration'; return out; }
  if (Math.abs(copyDur - ytDur) > DUR_TOL) { out.reason = 'duration'; return out; }
  if (points.length < MIN_POINTS) { out.reason = 'few-points'; return out; }
  const nominal = points.length > 1 ? (points[points.length - 1].t - points[0].t) / (points.length - 1) : 0;
  if (!(nominal > 0)) { out.reason = 'few-points'; return out; }
  const fits = [];
  for (let a = nominal * 0.97; a <= nominal * 1.06; a += nominal * 0.001){
    for (let b = -SHIFT_SEARCH; b <= SHIFT_SEARCH + 1e-9; b += 0.25){
      let sum = 0, n = 0;
      for (let k = 0; k < points.length; k++){
        const i = Math.round((a * k + b) * RATE);
        if (i < 0 || i >= track.length) continue;
        sum += Math.abs(track[i] - points[k].L); n++;
      }
      if (n < Math.max(MIN_POINTS, points.length * 0.9)) continue;
      fits.push({ step: a, shift: b, mad: sum / n });
    }
  }
  if (!fits.length) { out.reason = 'no-overlap'; return out; }
  // шаг и сдвиг слегка взаимозаменяемы (5.024/-0.75 ≈ 5.000/0): из почти
  // равных по точности подгонок берём самую близкую к нулевому сдвигу —
  // иначе у того же ролика сдвиг гуляет по случайному минимуму
  const floor = Math.min(...fits.map((f) => f.mad));
  const best = fits.filter((f) => f.mad <= floor + MAD_TIE)
    .sort((x, y) => Math.abs(x.shift) - Math.abs(y.shift) || x.mad - y.mad)[0];
  let agree = 0, decided = 0;
  for (let k = 0; k < points.length; k++){
    const i = Math.round((best.step * k + best.shift) * RATE);
    if (i < 0 || i >= track.length) continue;
    const L = track[i], P = points[k].L;
    // решение сравниваем только вне серой зоны (обе стороны уверенны)
    if (Math.abs(P - 138) > 14 && Math.abs(L - 138) > 14){ decided++; if (dark(L) === dark(P)) agree++; }
  }
  Object.assign(out, { step: +best.step.toFixed(3), shift: best.shift, mad: +best.mad.toFixed(1),
    agree: decided ? +(agree / decided).toFixed(3) : 1, decided });
  if (Math.abs(best.shift) > MAX_SHIFT) { out.reason = 'shift'; return out; }
  if (best.mad > MAD_MAX) { out.reason = 'mad'; return out; }
  if (out.agree < AGREE_MIN) { out.reason = 'agree'; return out; }
  out.ok = true; out.reason = 'match';
  return out;
}

// Гистерезис сэмплера страницы (chrome.mjs): первый кадр — порог 140, дальше
// светлая→тёмная выше 150, тёмная→светлая ниже 126. Вспышка короче полсекунды
// цвет не дёргает (пара смен ближе MIN_RUN снимается).
export const MIN_RUN = 2;
export function switches(track){
  if (!track || !track.length) return { d0: 0, s: [] };
  let d = track[0] > 140; const d0 = d ? 1 : 0; const raw = [];
  for (let i = 1; i < track.length; i++){
    const L = track[i];
    if (!d && L > 150){ d = true; raw.push(i); }
    else if (d && L < 126){ d = false; raw.push(i); }
  }
  const s = [];
  for (const i of raw){
    if (s.length && i - s[s.length - 1] < MIN_RUN) s.pop();
    else s.push(i);
  }
  return { d0, s };
}
// Цвет в момент t по шкале — тот же расчёт, что у страницы (yt-engine.mjs lumAt).
export function darkAt(tr, t){
  const q = Math.floor(t * RATE); let n = 0;
  for (const i of tr.s){ if (i <= q) n++; else break; }
  return !!(tr.d0 ^ (n & 1));
}

// ─── план ───────────────────────────────────────────────────────────────
export const isYt = (v) => /^[A-Za-z0-9_-]{11}$/.test(String(v || ''));
export const RETRY_DAYS = 3;           // неудача (сеть, бот-стена, сверка) — повтор через 3 дня
export const UNAVAILABLE_DAYS = 30;    // ролика на YouTube нет — карточка играет наш файл, шкала не нужна
export const RELEASES = ['clips3', 'clips2', 'clips']; // тома склада копий, новые первыми
// Версия движка карты: при смене сбрасываем yt-info/no-source/error, чтобы
// починка клиентов YouTube сразу пересчитала дыру, а не ждала RETRY_DAYS.
// unavailable не трогаем — снятый ролик от смены клиента не оживает.
export const ENGINE = 3;
export const RETRYABLE_FAILS = ['yt-info', 'no-source', 'error'];

export function copyCandidates(id, assets){
  // полная запись интервью, обычная копия, облегчённая .480 — по порядку; у
  // интервью <id>.mp4 — 24-секундная нарезка, её отсеет сверка длительности
  const out = [];
  for (const name of ['full-' + id + '.mp4', id + '.mp4', id + '.480.mp4'])
    for (const tag of RELEASES) if (assets.has(tag + '/' + name)) { out.push(tag + '/' + name); break; }
  return out;
}

export function planList(covers, map, assets, now = Date.now()){
  const tracks = (map && map.tracks) || {}, fails = (map && map.fails) || {};
  const seen = new Set(), list = [];
  for (const x of Array.isArray(covers) ? covers : []){
    if (!x || !isYt(x.v) || seen.has(x.v)) continue;
    seen.add(x.v);
    if (tracks[x.v]) continue;
    const f = fails[x.v];
    if (f && f.at){
      const age = (now - Date.parse(f.at)) / 86400000;
      if (age < (f.reason === 'unavailable' ? UNAVAILABLE_DAYS : RETRY_DAYS)) continue;
    }
    list.push({ id: x.v, d: String(x.d || ''), copies: copyCandidates(x.v, assets) });
  }
  // свежие посты первыми: их видят на главной
  list.sort((a, b) => (b.d > a.d ? 1 : b.d < a.d ? -1 : 0));
  return list;
}

export function shard(list, n){
  const out = Array.from({ length: n }, () => []);
  list.forEach((x, i) => out[i % n].push(x));
  return out.filter((x) => x.length);
}

// ─── один ролик ─────────────────────────────────────────────────────────
const PROXY = process.env.YTDLP_PROXY || '';
const REPO = process.env.GITHUB_REPOSITORY || 'xqtrn/svic-visio-test';
function sh(cmd, args, opts = {}){
  const { timeout = 15 * 60000, ...rest } = opts;
  const r = spawnSync(cmd, args, { maxBuffer: 1 << 28, encoding: 'utf8', timeout, ...rest });
  if (r.error) r.stderr = String(r.stderr || '') + '\n' + (r.error.code === 'ETIMEDOUT' ? 'timeout' : r.error.message);
  if (r.signal) r.stderr = String(r.stderr || '') + '\nsignal=' + r.signal;
  return r;
}
// YouTube с 2025 требует PO-token: его чеканит EJS на внешнем JS-рантайме.
// Deno у yt-dlp включён по умолчанию, на ubuntu-latest его нет; Node 22 уже
// ставит setup-node — его и указываем. Без этого флага любой player_client
// ловит бот-стену, даже через жилой SOCKS Пингвина.
export const YT_JS_RUNTIME = ['--js-runtimes', 'node'];
function proxyArgs(){ return PROXY ? ['--proxy', PROXY] : []; }
export function ytDlpArgs(extra = []){
  return [...YT_JS_RUNTIME, ...proxyArgs(), ...extra];
}
function ytErr(r){
  const t = String((r && r.stderr) || '') + '\n' + String((r && r.stdout) || '');
  return (t.split('\n').find((l) => /ERROR|timeout|signal=/.test(l)) || t.trim().split('\n').filter(Boolean).pop() || '').slice(0, 200);
}

// Снятый / закрытый по возрасту / стране — карточка играет наш файл, шкала
// не нужна. «Confirm you’re not a bot» сюда не входит: ролик на сайте играет,
// это отказ web-клиента yt-dlp, не самого YouTube.
export const DEAD_YT = /unavailable|private|removed|terminated|does not exist|not made this video available|not available in your country|confirm your age|this video is private|copyright/i;

// web_safari даёт миниатюры перемотки (сверка копии). ios/android/tv_embedded
// длительность без бот-стены web. tv_embedded ещё и возрастную заглушку.
export const YT_INFO_CLIENTS = ['web_safari', 'web', 'ios', 'android', 'tv_embedded'];

// Первая попытка — прогрессивный mp4 (без ffmpeg внутри yt-dlp: «Did not get
// any data blocks» и обрыв googlevideo на склейке DASH). Вторая — раздельные
// потоки через клиент телевизора, если прогрессивного нет.
export const YT_DL_ATTEMPTS = [
  { clients: 'ios,android,web_safari', format: 'b[height<=360][ext=mp4]/bv*[height<=360][ext=mp4]/b[height<=360][ext=mp4]' },
  { clients: 'tv_embedded,android,ios', format: 'bv*[height<=360]+ba/b[height<=360]/worst' },
];

export function settleYtInfo(attempts){
  let fallback = null, last = '';
  for (const a of attempts || []){
    if (a && a.info){
      if (pickStoryboard(a.info)) return { info: a.info, client: a.client };
      if (!fallback && Number(a.info.duration) > 0) fallback = a;
    } else if (a && a.error) last = a.error;
  }
  if (fallback) return { info: fallback.info, client: fallback.client };
  return { error: String(last).slice(0, 200), unavailable: DEAD_YT.test(last) };
}

export function ytInfo(id){
  const url = 'https://www.youtube.com/watch?v=' + id;
  const attempts = [];
  for (const client of YT_INFO_CLIENTS){
    const r = sh('yt-dlp', ['-J', '--skip-download', '--no-playlist', '--no-warnings', ...ytDlpArgs(),
      '--extractor-args', 'youtube:player_client=' + client, url]);
    if (r.status === 0){
      try { attempts.push({ info: JSON.parse(r.stdout), client }); }
      catch (e) { attempts.push({ error: 'json', client }); }
    } else attempts.push({ error: ytErr(r), client });
    const last = attempts[attempts.length - 1];
    if (last.info && pickStoryboard(last.info)) break;
  }
  return settleYtInfo(attempts);
}

export function refreshMap(map){
  const src = map && typeof map === 'object' ? map : {};
  const out = { v: src.v || 1, engine: ENGINE, since: src.since, updated: src.updated,
    tracks: { ...(src.tracks || {}) }, fails: { ...(src.fails || {}) } };
  const reset = [];
  if (src.engine === ENGINE) return { map: out, reset };
  for (const [id, f] of Object.entries(out.fails)){
    if (f && RETRYABLE_FAILS.includes(f.reason)){ delete out.fails[id]; reset.push(id); }
  }
  return { map: out, reset };
}

function curlTo(url, file){
  const r = sh('curl', ['-sfL', '--retry', '2', '-o', file, ...(PROXY && /ytimg|googlevideo/.test(url) ? ['--proxy', PROXY] : []), url]);
  return r.status === 0 && existsSync(file) && statSync(file).size > 1000;
}

async function fetchViaCurl(url){
  const r = spawnSync('curl', ['-sfL', '--retry', '2', ...(PROXY ? ['--proxy', PROXY] : []), url], { maxBuffer: 1 << 26 });
  return { ok: r.status === 0, status: r.status, arrayBuffer: async () => r.stdout };
}

function readTrack(file, label, tried){
  try {
    const track = trackFromVideo(file);
    if (!track.length){ tried.push({ c: label, reason: 'empty-track' }); return null; }
    return track;
  } catch (e) {
    tried.push({ c: label, reason: 'error', error: String(e && e.message || e).slice(0, 200) });
    return null;
  }
}

export function downloadYoutube(id, dest){
  let last = '';
  for (const a of YT_DL_ATTEMPTS){
    rmSync(dest, { force: true });
    const r = sh('yt-dlp', ['--no-playlist', '--no-continue', '--no-progress', '--no-warnings',
      '--retries', '8', '--fragment-retries', '8', '--socket-timeout', '30',
      ...ytDlpArgs(),
      '--extractor-args', 'youtube:player_client=' + a.clients,
      '-f', a.format, '--merge-output-format', 'mp4', '-o', dest,
      'https://www.youtube.com/watch?v=' + id], { timeout: 8 * 60000 });
    if (r.status === 0 && existsSync(dest) && statSync(dest).size > 10000){
      const dur = probeDuration(dest);
      if (dur > 1) return { ok: true, dur, attempt: a };
    }
    last = ytErr(r) || 'download-failed';
  }
  return { ok: false, error: last };
}

export async function processOne(id, copies, work){
  mkdirSync(work, { recursive: true });
  const yt = ytInfo(id);
  if (!yt.info) return { id, ok: false, reason: yt.unavailable ? 'unavailable' : 'yt-info', error: yt.error };
  const info = yt.info, ytDur = Number(info.duration) || 0;
  const sb = pickStoryboard(info);
  let points = null;
  const tried = [];
  const getPoints = async () => {
    if (points === null){ try { points = sb ? await storyboardLum(sb, fetchViaCurl) : []; } catch (e) { points = []; } }
    return points;
  };
  for (const c of copies){
    const f = join(work, 'copy.mp4'); rmSync(f, { force: true });
    if (!curlTo(`https://github.com/${REPO}/releases/download/${c}`, f)){ tried.push({ c, reason: 'download' }); continue; }
    const copyDur = probeDuration(f);
    if (Math.abs(copyDur - ytDur) > DUR_TOL){ tried.push({ c, reason: 'duration', copyDur: +copyDur.toFixed(2), ytDur }); continue; }
    const track = readTrack(f, c, tried);
    if (!track) continue;
    const v = verify({ track, points: await getPoints(), copyDur, ytDur });
    tried.push({ c, ...v });
    if (v.ok){ rmSync(f, { force: true }); return { id, ok: true, src: 'copy:' + c, v: slimV(v), ...switches(track), n: track.length }; }
  }
  // Ни одна копия не прошла — берём сам ролик с YouTube в самом лёгком виде:
  // это ровно то, что играет карточка, сверка тут лишь для отчёта.
  const yf = join(work, 'yt.mp4');
  const dl = downloadYoutube(id, yf);
  if (dl.ok){
    if (Math.abs(dl.dur - ytDur) <= DUR_TOL){
      const track = readTrack(yf, 'youtube', tried);
      if (track){
        const v = verify({ track, points: await getPoints(), copyDur: dl.dur, ytDur });
        rmSync(yf, { force: true });
        return { id, ok: true, src: 'youtube', v: slimV(v), tried, ...switches(track), n: track.length };
      }
    } else tried.push({ c: 'youtube', reason: 'duration', copyDur: +dl.dur.toFixed(2), ytDur });
  } else tried.push({ c: 'youtube', reason: 'download', error: dl.error });
  rmSync(yf, { force: true });
  return { id, ok: false, reason: 'no-source', tried };
}
const slimV = (v) => ({ reason: v.reason, mad: v.mad, agree: v.agree, step: v.step, shift: v.shift, points: v.points });

// ─── сборка карты ──────────────────────────────────────────────────────
export function mergeResults(map, results, now = Date.now()){
  const out = { v: 1, engine: ENGINE, since: (map && map.since) || new Date(now).toISOString(), updated: new Date(now).toISOString(), tracks: { ...((map && map.tracks) || {}) }, fails: { ...((map && map.fails) || {}) } };
  const stat = { ok: 0, fail: 0, bySrc: {}, byReason: {} };
  for (const r of results){
    if (!r || !isYt(r.id)) continue;
    if (r.ok && Array.isArray(r.s)){
      out.tracks[r.id] = { d0: r.d0 ? 1 : 0, s: r.s, src: r.src, n: r.n, v: r.v };
      delete out.fails[r.id];
      stat.ok++; const k = String(r.src).split(':')[0]; stat.bySrc[k] = (stat.bySrc[k] || 0) + 1;
    } else {
      const prev = out.fails[r.id] || {};
      out.fails[r.id] = { reason: r.reason, n: (prev.n || 0) + 1, at: new Date(now).toISOString(), tried: r.tried || undefined, error: r.error || undefined };
      stat.fail++; stat.byReason[r.reason] = (stat.byReason[r.reason] || 0) + 1;
    }
  }
  return { map: out, stat };
}

// Дыра покрытия — YouTube-карточки без шкалы, у которых конвейер уже дважды
// споткнулся, плюс карточки старше 3 дней, до которых он так и не дошёл, когда
// первый проход по всему складу давно позади (2 дня с рождения карты). Снятые с
// YouTube не в счёт — их карточка играет наш файл, а его кадр страница читает сама.
export function coverageGap(covers, map, now = Date.now()){
  const tracks = (map && map.tracks) || {}, fails = (map && map.fails) || {};
  const settled = map && map.since && (now - Date.parse(map.since)) / 86400000 > 2;
  const miss = [], seen = new Set(); let total = 0;
  for (const x of Array.isArray(covers) ? covers : []){
    if (!x || !isYt(x.v) || seen.has(x.v)) continue; seen.add(x.v);
    const f = fails[x.v];
    if (f && f.reason === 'unavailable') continue;
    total++;
    if (tracks[x.v]) continue;
    const age = x.d ? (now - Date.parse(x.d)) / 86400000 : 99;
    if ((f && f.n >= 2) || (!f && settled && age > 3)) miss.push({ id: x.v, reason: (f && f.reason) || 'not-yet', u: x.u });
  }
  return { total, miss };
}

async function main(){
  const [cmd, ...a] = process.argv.slice(2);
  const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch (e) { return d; } };
  if (cmd === 'plan'){
    const [coversF, mapF, assetsF, nS, outdir] = a;
    const covers = readJson(coversF, []);
    if (!Array.isArray(covers) || !covers.length){ console.error('манифест роликов сайта пуст — план не строю'); process.exit(1); }
    const assets = new Set(readFileSync(assetsF, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean));
    const { map, reset } = refreshMap(readJson(mapF, {}));
    if (reset.length) console.log(`движок ${ENGINE}: повтор ${reset.length} неудач (yt-info/no-source/error)`);
    const list = planList(covers, map, assets);
    const shards = shard(list, Math.max(1, Number(nS) || 1));
    mkdirSync(outdir, { recursive: true });
    shards.forEach((sh_, k) => writeFileSync(join(outdir, `plan-${k}.tsv`), sh_.map((x) => [x.id, x.copies.join(',') || '-'].join('\t')).join('\n') + '\n'));
    writeFileSync(join(outdir, 'shards.json'), JSON.stringify(shards.map((_, k) => k)));
    console.log(`к расчёту ${list.length} роликов, ${shards.length} потоков; с копией в релизе — ${list.filter((x) => x.copies.length).length}`);
    return;
  }
  if (cmd === 'run'){
    const [planF, outdir, budget] = a;
    const until = Date.now() + (Number(budget) || 4200) * 1000;
    mkdirSync(outdir, { recursive: true });
    const rows = readFileSync(planF, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
    let done = 0;
    for (const row of rows){
      if (Date.now() > until){ console.log('время прогона вышло — остаток доберёт следующий'); break; }
      const [id, cs] = row.split('\t');
      if (!isYt(id)) continue;
      const t0 = Date.now();
      let res;
      try { res = await processOne(id, cs && cs !== '-' ? cs.split(',') : [], join(outdir, '.work')); }
      catch (e) { res = { id, ok: false, reason: 'error', error: String(e && e.message || e).slice(0, 200) }; }
      writeFileSync(join(outdir, id + '.json'), JSON.stringify(res));
      done++;
      console.log(`${id} ${res.ok ? 'OK ' + res.src + ' смен ' + res.s.length + (res.v ? ' mad ' + res.v.mad : '') : 'НЕТ ' + res.reason} ${((Date.now() - t0) / 1000).toFixed(0)}с`);
      // бережём Пингвина и YouTube: между роликами пауза
      spawnSync('sleep', ['2']);
    }
    rmSync(join(outdir, '.work'), { recursive: true, force: true });
    console.log(`готово ${done} из ${rows.length}`);
    return;
  }
  if (cmd === 'merge'){
    const [mapF, dir] = a;
    const results = existsSync(dir) ? readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.json')).map((f) => readJson(join(dir, String(f)), null)) : [];
    const { map: base } = refreshMap(readJson(mapF, {}));
    const { map, stat } = mergeResults(base, results);
    writeFileSync(mapF, JSON.stringify(map));
    console.log(`шкал в карте: ${Object.keys(map.tracks).length}; этот прогон: +${stat.ok}, неудач ${stat.fail}; источники ${JSON.stringify(stat.bySrc)}; причины ${JSON.stringify(stat.byReason)}`);
    return;
  }
  if (cmd === 'watch'){
    const [coversF, mapF] = a;
    const covers = readJson(coversF, []), map = readJson(mapF, {});
    const { total, miss } = coverageGap(covers, map);
    console.log(`YouTube-карточек ${total}, без шкалы старше 3 дней: ${miss.length}`);
    const { openTask, closeTask } = await import('./system-task.mjs');
    const key = 'site-video-date-tone-coverage';
    if (!miss.length) { await closeTask(key, 'у всех YouTube-карточек есть шкала цвета даты'); return; }
    await openTask({ key,
      summary: `Дата на ${miss.length} видео-карточках не меняет цвет`,
      ownerBrief: `На ${miss.length} карточках с роликом YouTube дата остаётся белой с тенью: для них не удалось посчитать, светлый ли кадр под датой.`,
      details: miss.slice(0, 40).map((m) => `${m.id} — ${m.reason} — ${m.u || ''}`).join('\n'),
      instructions: 'Конвейер svic-visio-test/.github/workflows/date-lum.yml считает шкалу яркости угла даты по нашей копии ролика (сверка с миниатюрами YouTube) или по самому ролику YouTube. Разобрать причины в fails карты date-lum.json (релиз date-lum): no-source — ни копия, ни YouTube не дали файл нужной длительности; yt-info — YouTube не ответил через Пингвина. Починить причину, перезапустить workflow; карточка закроется сама, когда дыра станет нулевой.' });
    return;
  }
  if (cmd === 'track'){
    const [video, infoPath] = a;
    const info = readJson(infoPath, {});
    const sb = pickStoryboard(info), copyDur = probeDuration(video);
    const track = trackFromVideo(video);
    const v = verify({ track, points: sb ? await storyboardLum(sb) : [], copyDur, ytDur: info.duration });
    console.log(JSON.stringify({ id: info.id, ...v, ...(v.ok ? switches(track) : {}) }));
    return;
  }
  console.error('usage: date-lum.mjs plan|run|merge|watch|track …'); process.exit(2);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
