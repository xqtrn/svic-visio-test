import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseCovers, segMapFromHtml, parsePostPage, postLinks, classify, pickBatch,
  resolveSegment, buildManifest, noteResult, normPath, WORKER_RELEASES, UPLOAD_RELEASE,
} from './iv-covers-plan.mjs';

const DAY = 86400000;
const NOW = Date.parse('2026-09-03T12:00:00Z');

test('манифест сайта: берём только голые YouTube-id, iv-* и самохост мимо, путь без хвостового слэша', () => {
  const posts = parseCovers([
    { v: 'mediatw6', u: '/2026/09/03/upwind/', d: '2026-09-03' },
    { v: 'omqr1AE7PQQ', u: '/2026/08/31/will-wang/', d: '2026-08-31' },
    { v: 'iv-Aq6mtdnN84Q', u: '/2026/07/08/chapter' },
    { v: 'Aq6mtdnN84Q', u: 'https://siliconvalleyinvestclub.com/2026/07/08/chapter/' },
    { v: 'omqr1AE7PQQ', u: '/dup/', d: '2026-01-01' },
  ]);
  assert.deepEqual(posts, [
    { u: '/2026/08/31/will-wang', v: 'omqr1AE7PQQ', d: '2026-08-31' },
    { u: '/2026/07/08/chapter', v: 'Aq6mtdnN84Q', d: '2026-07-08' },
  ]);
  assert.equal(normPath('/'), '/');
});

test('сегменты с главной: 0..0 и e<=s = не задано', () => {
  const html = '<div class="cs-video-wrapper" data-video-start="0" data-video-end="0" data-svic-vid="mediatw6"></div>'
    + '<div class="cs-video-wrapper" data-video-start="1" data-video-end="35" data-svic-vid="omqr1AE7PQQ"></div>'
    + '<div class="cs-video-wrapper" data-video-start="0" data-video-end="0" data-svic-vid="6mlgj74EFM8"></div>';
  assert.deepEqual(segMapFromHtml(html), { omqr1AE7PQQ: { s: 1, e: 35 } });
});

test('страница поста: три поколения разметки', () => {
  assert.deepEqual(parsePostPage('<figure><div class="sa-hero-wrap" data-svic-yt-hero="omqr1AE7PQQ"></div></figure>'), { vid: 'omqr1AE7PQQ', seg: null, selfHosted: false });
  assert.deepEqual(parsePostPage('<div class="cs-video-wrapper" data-video-start="2" data-video-end="30" data-svic-vid="XgJ2qw8_kUM"></div>'), { vid: 'XgJ2qw8_kUM', seg: { s: 2, e: 30 }, selfHosted: false });
  assert.deepEqual(parsePostPage('<div class="cs-entry__media"><div data-svic-vid="full-Aq6mtdnN84Q" data-video-start="1" data-video-end="35"></div></div>'), { vid: 'Aq6mtdnN84Q', seg: { s: 1, e: 35 }, selfHosted: false });
  assert.equal(parsePostPage('<div class="cs-entry__media"><div data-svic-vid="cs-abc"></div></div>').selfHosted, true);
  assert.equal(parsePostPage('<iframe src="https://www.youtube.com/embed/Yqo8-fXhNAA?x=1"></iframe>').vid, 'Yqo8-fXhNAA');
  assert.deepEqual(postLinks('<a href="https://siliconvalleyinvestclub.com/2026/08/31/will-wang/">x</a><a href="/2026/08/31/will-wang">y</a><a href="/companies/x/">z</a>'), ['/2026/08/31/will-wang']);
});

test('раскладка: лежащий фрагмент и .480 — пропуск, «без ничего» раньше полной копии, свежие первыми', () => {
  const posts = [
    { u: '/a', v: 'AAAAAAAAAAA', d: '2026-08-31' }, // ничего
    { u: '/b', v: 'BBBBBBBBBBB', d: '2026-09-01' }, // полная копия
    { u: '/c', v: 'CCCCCCCCCCC', d: '2024-01-01' }, // ничего, старый
    { u: '/d', v: 'DDDDDDDDDDD', d: '2026-09-02' }, // фрагмент лежит
    { u: '/e', v: 'EEEEEEEEEEE', d: '2026-09-02' }, // .480 лежит
    { u: '/f', v: 'FFFFFFFFFFF', d: '2026-09-02' }, // фрагмент лежит, но немой
  ];
  const assets = ['BBBBBBBBBBB.mp4', 'iv-DDDDDDDDDDD.mp4', 'EEEEEEEEEEE.480.mp4', 'EEEEEEEEEEE.mp4', 'iv-FFFFFFFFFFF.mp4', 'FFFFFFFFFFF.mp4'];
  const cls = classify(posts, assets, { FFFFFFFFFFF: { audio: false } }, NOW);
  assert.deepEqual(cls.haveIv.map((p) => p.v), ['DDDDDDDDDDD']);
  assert.deepEqual(cls.have480.map((p) => p.v), ['EEEEEEEEEEE']);
  assert.deepEqual(cls.candidates.map((p) => `${p.v}:${p.why}`), ['FFFFFFFFFFF:silent', 'AAAAAAAAAAA:none', 'CCCCCCCCCCC:none', 'BBBBBBBBBBB:full']);
});

test('леджер: три неудачи подряд отводят ролик на неделю, снятый с YouTube — на месяц', () => {
  const posts = [{ u: '/a', v: 'AAAAAAAAAAA', d: '2026-08-31' }, { u: '/b', v: 'BBBBBBBBBBB', d: '2026-08-30' }, { u: '/c', v: 'CCCCCCCCCCC', d: '2026-08-29' }];
  const fresh = new Date(NOW - 2 * DAY).toISOString();
  const stale = new Date(NOW - 9 * DAY).toISOString();
  const ledger = {
    AAAAAAAAAAA: { fails: 3, last: fresh },
    BBBBBBBBBBB: { fails: 3, last: stale },
    CCCCCCCCCCC: { unavailable: new Date(NOW - 40 * DAY).toISOString() },
  };
  const cls = classify(posts, [], ledger, NOW);
  assert.deepEqual(cls.deferred.map((p) => `${p.v}:${p.why}`), ['AAAAAAAAAAA:fails']);
  assert.deepEqual(cls.candidates.map((p) => p.v), ['BBBBBBBBBBB', 'CCCCCCCCCCC']);
  const l2 = { CCCCCCCCCCC: { unavailable: fresh } };
  assert.deepEqual(classify(posts, [], l2, NOW).deferred.map((p) => p.why), ['unavailable']);
});

test('партия: лимит считает только попытки; oEmbed 4xx (удалён/приватный/не id) пропускает без yt-dlp и пишет в леджер', async () => {
  const cands = ['A', 'B', 'C', 'D', 'E', 'F'].map((c, i) => ({ v: c.repeat(11), u: '/' + c, d: '2026-08-0' + (9 - i), why: 'none' }));
  const codes = { AAAAAAAAAAA: 200, BBBBBBBBBBB: 404, CCCCCCCCCCC: 403, DDDDDDDDDDD: 200, EEEEEEEEEEE: 503, FFFFFFFFFFF: 200 };
  const ledger = {};
  const { picked, unavailable } = await pickBatch(cands, 3, async (v) => codes[v], ledger, NOW);
  assert.deepEqual(picked.map((p) => p.v), ['AAAAAAAAAAA', 'DDDDDDDDDDD', 'EEEEEEEEEEE']);
  assert.deepEqual(unavailable.map((p) => p.v), ['BBBBBBBBBBB', 'CCCCCCCCCCC']);
  assert.equal(ledger.BBBBBBBBBBB.unavailable, new Date(NOW).toISOString());
  assert.equal(ledger.CCCCCCCCCCC.unavailable, new Date(NOW).toISOString());
  assert.equal(ledger.EEEEEEEEEEE, undefined);
  const zero = await pickBatch(cands, 0, async () => 200, {}, NOW);
  assert.equal(zero.picked.length, 0);
});

test('сегмент: главная > страница поста > курируемые > 1..25; e<=s растягивается на 24с', () => {
  assert.deepEqual(resolveSegment('X', { home: { X: { s: 3, e: 40 } }, page: { s: 1, e: 30 }, curated: { X: { s: 5, e: 50 } } }), { s: 3, e: 40 });
  assert.deepEqual(resolveSegment('X', { page: { s: 1, e: 30 }, curated: { X: { s: 5, e: 50 } } }), { s: 1, e: 30 });
  assert.deepEqual(resolveSegment('X', { curated: { X: { s: 5, e: 50 } } }), { s: 5, e: 50 });
  assert.deepEqual(resolveSegment('X'), { s: 1, e: 25 });
  assert.deepEqual(resolveSegment('X', { curated: { X: { s: 10, e: 4 } } }), { s: 10, e: 34 });
});

test('манифест: все посты, чей iv-<id>.mp4 лежит в релизе, который читает воркер; имя ключа iv-<id>', () => {
  const posts = [{ u: '/a/', v: 'AAAAAAAAAAA' }, { u: '/b', v: 'BBBBBBBBBBB' }, { u: '/c', v: 'iv-CCCCCCCCCCC' }, { u: '/a', v: 'AAAAAAAAAAA' }];
  assert.deepEqual(buildManifest(posts, ['iv-AAAAAAAAAAA.mp4', 'BBBBBBBBBBB.mp4', 'iv-CCCCCCCCCCC.mp4']), [{ u: '/a', v: 'iv-AAAAAAAAAAA' }]);
  assert.deepEqual(WORKER_RELEASES, ['clips', 'clips2']);
  assert.ok(WORKER_RELEASES.includes(UPLOAD_RELEASE));
});

test('леджер: удача обнуляет счётчик неудач и помнит звук, неудача копит', () => {
  const l = noteResult({}, 'AAAAAAAAAAA', 'fail', 'ERROR: Sign in to confirm', NOW);
  noteResult(l, 'AAAAAAAAAAA', 'fail', 'x'.repeat(500), NOW);
  assert.equal(l.AAAAAAAAAAA.fails, 2);
  assert.equal(l.AAAAAAAAAAA.reason.length, 200);
  noteResult(l, 'AAAAAAAAAAA', 'ok', '', NOW);
  assert.equal(l.AAAAAAAAAAA.fails, undefined);
  assert.equal(l.AAAAAAAAAAA.audio, true);
  assert.equal(l.AAAAAAAAAAA.cut, new Date(NOW).toISOString());
});

test('воркфлоу: источник — /__covers.json, лимит партии из workflow_dispatch, ошибки роликов не валят прогон', () => {
  const yml = readFileSync(new URL('../.github/workflows/iv-covers.yml', import.meta.url), 'utf8');
  assert.match(yml, /iv-covers-plan\.mjs plan/);
  assert.match(yml, /iv-covers-plan\.mjs manifest/);
  assert.match(yml, /iv-covers-plan\.mjs report/);
  assert.match(yml, /batch:/);
  assert.match(yml, /inputs\.batch \|\| '25'/);
  assert.match(yml, /--download-sections/);
  assert.doesNotMatch(yml, /\[ "\$FAIL" = "0" \]/);
  assert.match(yml, /interview-covers\.json/);
});
