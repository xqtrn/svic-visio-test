// Замок шкал цвета даты (scripts/date-lum.mjs, Артур 2026-10-11).
// node --test scripts/date-lum.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verify, switches, darkAt, planList, copyCandidates, mergeResults, coverageGap, RATE,
  settleYtInfo, refreshMap, ENGINE, DEAD_YT, YT_INFO_CLIENTS, YT_DL_ATTEMPTS,
  YT_JS_RUNTIME, ytDlpArgs, YT_WORKING_CLIENTS } from './date-lum.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Синтетический ролик: сцены разной яркости разной длины, 5-секундные миниатюры.
function scene(sec){
  const lens = [7, 3, 11, 4, 9, 2, 13, 5, 6, 8, 3, 10, 7, 4, 12];
  const levels = [20, 200, 30, 170, 15, 220, 40, 190, 25, 160, 10, 210, 35, 180, 20];
  let t = 0;
  for (let k = 0; ; k = (k + 1) % lens.length){ t += lens[k]; if (sec < t) return levels[k]; }
}
const DUR = 180;
const TRACK = Uint8Array.from({ length: DUR * RATE }, (_, i) => scene(i / RATE));
const POINTS = Array.from({ length: Math.floor(DUR / 5) }, (_, k) => ({ t: k * 4.9, L: scene(k * 5) + ((k * 7) % 5) - 2 }));
const shifted = (sec) => Uint8Array.from({ length: DUR * RATE }, (_, i) => scene(Math.max(0, i / RATE + sec)));

test('тот же ролик проходит сверку (шаг миниатюр подбирается, сдвиг около нуля)', () => {
  const v = verify({ track: TRACK, points: POINTS, copyDur: DUR, ytDur: DUR });
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.ok(Math.abs(v.shift) <= 0.75);
});

test('копия со сдвигом от 2 секунд — отказ (лишнее вступление / обрезанное начало)', () => {
  for (const s of [2, 3, -3, 10]){
    const v = verify({ track: shifted(s), points: POINTS, copyDur: DUR, ytDur: DUR });
    assert.equal(v.ok, false, 'сдвиг ' + s + ': ' + JSON.stringify(v));
  }
});

test('чужой ролик той же длины — отказ', () => {
  const other = Uint8Array.from({ length: DUR * RATE }, (_, i) => scene(DUR - i / RATE));
  assert.equal(verify({ track: other, points: POINTS, copyDur: DUR, ytDur: DUR }).ok, false);
});

test('длительность копии не совпала с YouTube — отказ без сверки (24-секундная нарезка)', () => {
  const v = verify({ track: TRACK.slice(0, 24 * RATE), points: POINTS, copyDur: 24, ytDur: 32 });
  assert.equal(v.ok, false); assert.equal(v.reason, 'duration');
});

test('смены цвета: гистерезис страницы и без дрожи короче полсекунды', () => {
  const tr = switches(Uint8Array.from([20, 20, 160, 160, 160, 145, 130, 120, 120, 200, 120, 120]));
  assert.equal(tr.d0, 0);
  // светлая→тёмная на 2 (160>150), 145/130 держат тёмную (>126), 120 — светлая на 7;
  // вспышка 200 на 9 длиной в один замер снимается целиком
  assert.deepEqual(tr.s, [2, 7]);
  assert.equal(darkAt(tr, 0), false);
  assert.equal(darkAt(tr, 0.5), true);
  assert.equal(darkAt(tr, 1.74), true);
  assert.equal(darkAt(tr, 1.75), false);
});

test('план: свежие первыми, со шкалой и недавними неудачами — мимо, снятые — раз в месяц', () => {
  const now = Date.parse('2026-10-11T00:00:00Z');
  const covers = [
    { v: 'aaaaaaaaaaa', d: '2026-01-01' }, { v: 'bbbbbbbbbbb', d: '2026-10-01' },
    { v: 'ccccccccccc', d: '2026-09-01' }, { v: 'ddddddddddd', d: '2026-09-02' },
    { v: 'eeeeeeeeeee', d: '2026-09-03' }, { v: 'umv0rg7kt-horizontal', d: '2026-10-09' },
  ];
  const map = { tracks: { ccccccccccc: { d0: 0, s: [] } }, fails: {
    ddddddddddd: { reason: 'no-source', at: '2026-10-10T00:00:00Z' },
    eeeeeeeeeee: { reason: 'unavailable', at: '2026-09-20T00:00:00Z' },
    aaaaaaaaaaa: { reason: 'yt-info', at: '2026-10-01T00:00:00Z' },
  } };
  const list = planList(covers, map, new Set(['clips/bbbbbbbbbbb.mp4', 'clips2/full-bbbbbbbbbbb.mp4']), now);
  assert.deepEqual(list.map((x) => x.id), ['bbbbbbbbbbb', 'aaaaaaaaaaa']);
  assert.deepEqual(list[0].copies, ['clips2/full-bbbbbbbbbbb.mp4', 'clips/bbbbbbbbbbb.mp4']);
});

test('копии: полная запись интервью первой, каждый вид — из самого нового тома', () => {
  const a = new Set(['clips/x1234567890.mp4', 'clips3/x1234567890.mp4', 'clips2/x1234567890.480.mp4']);
  assert.deepEqual(copyCandidates('x1234567890', a), ['clips3/x1234567890.mp4', 'clips2/x1234567890.480.mp4']);
});

test('сборка карты: удача стирает неудачу, неудача копит счётчик', () => {
  const { map } = mergeResults({ tracks: {}, fails: { aaaaaaaaaaa: { reason: 'yt-info', n: 1 } } }, [
    { id: 'aaaaaaaaaaa', ok: true, d0: 1, s: [3, 9], src: 'youtube', n: 40 },
    { id: 'bbbbbbbbbbb', ok: false, reason: 'no-source' },
  ]);
  assert.deepEqual(map.tracks.aaaaaaaaaaa.s, [3, 9]);
  assert.equal(map.fails.aaaaaaaaaaa, undefined);
  assert.equal(map.fails.bbbbbbbbbbb.n, 1);
});

test('сторож: дважды споткнувшиеся и забытые после первого прохода; снятые с YouTube не в счёт', () => {
  const now = Date.parse('2026-10-11T00:00:00Z');
  const covers = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee', 'fffffffffff']
    .map((v) => ({ v, d: v === 'aaaaaaaaaaa' ? '2026-10-10' : '2026-09-01' }));
  const fails = { ddddddddddd: { reason: 'unavailable', n: 3 }, eeeeeeeeeee: { reason: 'no-source', n: 2 }, fffffffffff: { reason: 'yt-info', n: 1 } };
  const tracks = { ccccccccccc: { d0: 0, s: [] } };
  // первый проход ещё идёт — не попытанные не дыра
  let g = coverageGap(covers, { since: '2026-10-10T00:00:00Z', tracks, fails }, now);
  assert.equal(g.total, 5);
  assert.deepEqual(g.miss.map((m) => m.id), ['eeeeeeeeeee']);
  // через 2 дня после рождения карты забытый старый пост — дыра, свежий — ещё нет
  g = coverageGap(covers, { since: '2026-10-01T00:00:00Z', tracks, fails }, now);
  assert.deepEqual(g.miss.map((m) => m.id).sort(), ['bbbbbbbbbbb', 'eeeeeeeeeee']);
});

test('workflow: замок теста в прогоне, горло apt, сторож покрытия, карта в релиз date-lum', () => {
  const yml = readFileSync(join(ROOT, '.github/workflows/date-lum.yml'), 'utf8');
  assert.match(yml, /node --test scripts\/date-lum\.test\.mjs/);
  assert.match(yml, /\.\/\.github\/actions\/repair-apt/);
  assert.match(yml, /date-lum\.mjs watch/);
  assert.match(yml, /gh release upload date-lum date-lum\.json/);
  assert.match(yml, /yt-dlp\[default/);
});

// Замок бага: карточка #b1851043-bcf5-4954-bcdc-01723ae40132
// 11 карточек без шкалы: web-клиент yt-dlp упёрся в бот-стену/возраст и не
// доходил до android/ios; 24-с нарезка не той длины, а скачивание с YouTube
// рвалось на DASH («Did not get any data blocks» / обрыв / обрезанный mp4).
test('Замок бага: карточка #b1851043-bcf5-4954-bcdc-01723ae40132 — бот-стена web не хоронит шкалу: android даёт длительность, возраст — unavailable', () => {
  const bot = 'ERROR: [youtube] x: Sign in to confirm you’re not a bot. Use --cookies';
  const age = 'ERROR: [youtube] WFtSptmNP3Q: Sign in to confirm your age. Use --cookies';
  const android = { duration: 208, formats: [] };
  const webSb = { duration: 208, formats: [{ format_note: 'storyboard', fragments: [{}], fps: 0.2, rows: 5, columns: 5, width: 160, height: 90 }] };
  assert.equal(settleYtInfo([{ error: bot, client: 'web_safari' }, { info: android, client: 'android' }]).info.duration, 208);
  assert.equal(settleYtInfo([{ error: bot, client: 'web_safari' }]).unavailable, false);
  assert.equal(settleYtInfo([{ error: bot, client: 'web_safari' }]).error.includes('not a bot'), true);
  assert.equal(settleYtInfo([{ error: age, client: 'web_safari' }, { error: age, client: 'tv_embedded' }]).unavailable, true);
  assert.equal(settleYtInfo([{ info: webSb, client: 'web_safari' }, { info: android, client: 'android' }]).client, 'web_safari');
  assert.equal(DEAD_YT.test(bot), false);
  assert.equal(DEAD_YT.test(age), true);
  assert.ok(YT_INFO_CLIENTS.includes('web_safari'));
});

test('Замок бага: карточка #b1851043-bcf5-4954-bcdc-01723ae40132 — скачивание идёт прогрессивным mp4, потом tv; обрезанный файл не стоп', () => {
  assert.ok(YT_DL_ATTEMPTS[0].format.includes('b[height<=360][ext=mp4]'));
  assert.ok(YT_DL_ATTEMPTS.some((a) => /tv_samsung|visionos|tv_simply/.test(a.clients)));
  const src = readFileSync(join(ROOT, 'scripts/date-lum.mjs'), 'utf8');
  assert.match(src, /function readTrack/);
  assert.match(src, /reason: 'error'/);
  assert.doesNotMatch(src, /wv\*\[height>=144\]\[height<=360\]\/bv\*\[height<=360\]\/wv\*\/worst/);
});

test('Замок бага: карточка #b1851043-bcf5-4954-bcdc-01723ae40132 — новый движок сразу повторяет yt-info/no-source/error', () => {
  const now = Date.parse('2026-10-14T19:00:00Z');
  const stale = { engine: 1, tracks: {}, fails: {
    WFtSptmNP3Q: { reason: 'yt-info', n: 2, at: '2026-10-14T19:19:38.872Z' },
    '0VD7T0wbras': { reason: 'no-source', n: 2, at: '2026-10-14T19:19:38.872Z' },
    JlChTvX4U4E: { reason: 'error', n: 2, at: '2026-10-14T19:19:38.872Z' },
    deadvideo11: { reason: 'unavailable', n: 1, at: '2026-10-14T19:19:38.872Z' },
  } };
  const { map, reset } = refreshMap(stale);
  assert.equal(map.engine, ENGINE);
  assert.deepEqual(reset.sort(), ['0VD7T0wbras', 'JlChTvX4U4E', 'WFtSptmNP3Q']);
  assert.equal(map.fails.deadvideo11.reason, 'unavailable');
  const covers = [
    { v: 'WFtSptmNP3Q', d: '2023-06-06' },
    { v: '0VD7T0wbras', d: '2024-01-09' },
    { v: 'JlChTvX4U4E', d: '2022-02-11' },
    { v: 'deadvideo11', d: '2022-01-01' },
  ];
  const list = planList(covers, map, new Set(), now);
  assert.deepEqual(list.map((x) => x.id).sort(), ['0VD7T0wbras', 'JlChTvX4U4E', 'WFtSptmNP3Q']);
  const again = refreshMap(map);
  assert.deepEqual(again.reset, []);
  assert.equal(again.map.fails.deadvideo11.reason, 'unavailable');
});

// Замок бага: карточка #f4fed8bd-3bb9-4e0f-89da-e49b8e492632
// 10 карточек без шкалы: мост к Пингвину был поднят, а все player_client
// (web/ios/android/tv) отвечали «confirm you’re not a bot» — yt-dlp на
// ubuntu-latest ставится из pip без EJS и без JS-рантайма (Deno нет, Node 22
// есть, но флаг --js-runtimes node не передавался), PO-token не чеканится.
test('Замок бага: карточка #f4fed8bd-3bb9-4e0f-89da-e49b8e492632 — бот-стена лечится EJS на Node, не новым клиентом', () => {
  assert.deepEqual(YT_JS_RUNTIME, ['--js-runtimes', 'node']);
  assert.deepEqual(ytDlpArgs().slice(0, 2), ['--js-runtimes', 'node']);
  assert.equal(ENGINE, 4);
  const src = readFileSync(join(ROOT, 'scripts/date-lum.mjs'), 'utf8');
  assert.match(src, /function ytInfo/);
  assert.equal((src.match(/sh\('yt-dlp'/g) || []).length, 2);
  assert.equal((src.match(/\.\.\.ytDlpArgs\(\)/g) || []).length, 2);
  const yml = readFileSync(join(ROOT, '.github/workflows/date-lum.yml'), 'utf8');
  assert.match(yml, /yt-dlp\[default/);
  assert.match(yml, /yt-dlp --js-runtimes node --version/);
  for (const c of ['web_safari', 'tv_samsung', 'visionos']) assert.ok(YT_INFO_CLIENTS.includes(c), c);
});

test('Замок бага: карточка #f4fed8bd-3bb9-4e0f-89da-e49b8e492632 — класс: любой yt-dlp YouTube на раннере с Node и EJS', () => {
  const files = [
    '.github/workflows/date-lum.yml',
    '.github/workflows/iv-covers.yml',
    '.github/workflows/convert.yml',
    '.github/workflows/download-missing.yml',
    '.github/workflows/interview-full.yml',
    '.github/workflows/archive-clips.yml',
    'archive-missing-clips.mjs',
  ];
  for (const f of files){
    const t = readFileSync(join(ROOT, f), 'utf8');
    if (f.endsWith('.yml')) assert.match(t, /yt-dlp\[default/, f);
    if (t.includes('player_client')) assert.match(t, /--js-runtimes node/, f);
  }
});

test('Замок бага: карточка #f4fed8bd-3bb9-4e0f-89da-e49b8e492632 — движок 3 сразу повторяет десять yt-info', () => {
  const now = Date.parse('2026-10-17T21:40:00Z');
  const ids = ['0VD7T0wbras', 'D4yCLAxfhDA', 'JlChTvX4U4E', 'YAqaymcxk44', 'WaX6PX0gRvY',
    'sZL_B3zLV2g', 'gcnlR0iIJ3I', 'dmDkwKCbyN8', 'hxJv8AKEeG4', 'gve7QsHaiVs'];
  const fails = Object.fromEntries(ids.map((id) => [id, { reason: 'yt-info', n: 2, at: '2026-10-17T21:31:45.178Z' }]));
  const { map, reset } = refreshMap({ engine: 2, tracks: {}, fails });
  assert.equal(map.engine, ENGINE);
  assert.deepEqual(reset.sort(), ids.slice().sort());
  const covers = ids.map((v) => ({ v, d: '2021-08-01' }));
  const list = planList(covers, map, new Set(), now);
  assert.deepEqual(list.map((x) => x.id).sort(), ids.slice().sort());
});

// Замок бага: карточка #cc97cde4-f479-45fc-a6b8-d9bf9c83218b
// 10 карточек без шкалы 21.10: мост к Пингвину поднят, Node EJS в PATH,
// yt-dlp 2026.08.19, а ios/android/tv_embedded отвечают бот-стеной.
// tv_embedded из экстрактора снят; default — tv_samsung,visionos,web.
test('Замок бага: карточка #cc97cde4-f479-45fc-a6b8-d9bf9c83218b — живые клиенты tv_samsung/visionos, мёртвые ios/android/tv_embedded не зовутся', () => {
  assert.equal(ENGINE, 4);
  for (const c of ['web_safari', 'tv_samsung', 'visionos', 'android_vr', 'tv_simply']) {
    assert.ok(YT_INFO_CLIENTS.includes(c), c);
  }
  for (const c of ['ios', 'android', 'tv_embedded', 'web']) {
    assert.equal(YT_INFO_CLIENTS.includes(c), false, c);
  }
  assert.match(YT_WORKING_CLIENTS, /tv_samsung/);
  assert.match(YT_WORKING_CLIENTS, /visionos/);
  assert.doesNotMatch(YT_WORKING_CLIENTS, /(^|,)(ios|android|tv_embedded)(,|$)/);
  for (const a of YT_DL_ATTEMPTS) {
    assert.doesNotMatch(a.clients, /(^|,)(ios|android|tv_embedded)(,|$)/);
    assert.match(a.clients, /tv_samsung|visionos|tv_simply/);
  }
});

test('Замок бага: карточка #cc97cde4-f479-45fc-a6b8-d9bf9c83218b — класс: текущий экстрактор и живые клиенты на любом yt-dlp YouTube', () => {
  const files = [
    '.github/workflows/date-lum.yml',
    '.github/workflows/iv-covers.yml',
    '.github/workflows/convert.yml',
    '.github/workflows/download-missing.yml',
    '.github/workflows/interview-full.yml',
    '.github/workflows/archive-clips.yml',
    'archive-missing-clips.mjs',
  ];
  for (const f of files){
    const t = readFileSync(join(ROOT, f), 'utf8');
    if (f.endsWith('.yml')) {
      assert.match(t, /yt-dlp\/archive\/master\.tar\.gz/, f);
      assert.match(t, /yt-dlp\[default,curl-cffi\]/, f);
    }
    if (t.includes('player_client')) {
      assert.match(t, /tv_samsung|visionos/, f);
      assert.doesNotMatch(t, /player_client=ios,android,web_safari/, f);
      assert.doesNotMatch(t, /tv_embedded/, f);
    }
  }
});

test('Замок бага: карточка #cc97cde4-f479-45fc-a6b8-d9bf9c83218b — движок 4 сразу повторяет десять yt-info/no-source', () => {
  const now = Date.parse('2026-10-21T01:10:00Z');
  const ids = ['0VD7T0wbras', 'D4yCLAxfhDA', 'JlChTvX4U4E', 'YAqaymcxk44', 'WaX6PX0gRvY',
    'sZL_B3zLV2g', 'gcnlR0iIJ3I', 'dmDkwKCbyN8', 'hxJv8AKEeG4', 'gve7QsHaiVs'];
  const fails = Object.fromEntries(ids.map((id, i) => [id, {
    reason: i === 0 ? 'no-source' : 'yt-info', n: 2, at: '2026-10-21T01:04:32.878Z',
  }]));
  const { map, reset } = refreshMap({ engine: 3, tracks: {}, fails });
  assert.equal(map.engine, ENGINE);
  assert.deepEqual(reset.sort(), ids.slice().sort());
  const covers = ids.map((v) => ({ v, d: '2021-08-01' }));
  const list = planList(covers, map, new Set(), now);
  assert.deepEqual(list.map((x) => x.id).sort(), ids.slice().sort());
  const again = refreshMap(map);
  assert.deepEqual(again.reset, []);
});
