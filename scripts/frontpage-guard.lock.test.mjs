import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { callThroat, REBUILD_WINDOW_MS } from './frontpage-guard.mjs';

const src = readFileSync(new URL('./frontpage-guard.mjs', import.meta.url), 'utf8');
const yml = readFileSync(new URL('../.github/workflows/frontpage-guard.yml', import.meta.url), 'utf8');

test('правило главной судит только горло стенда — второй копии и доступа к базе нет', () => {
  assert.match(src, /\/api\/internal\/frontpage-refresh/);
  assert.match(src, /heal: true/);
  assert.match(src, /siliconvalleyinvestclub\.com/);
  assert.doesNotMatch(src, /test\.siliconvalleyinvestclub\.com/);
  // 15–24.09: копия правила на устаревшей базе дала 9 ложных карточек
  assert.doesNotMatch(src, /from 'pg'|new pg\.Pool|SVIC_PLATFORM_DATABASE_URL/);
  assert.doesNotMatch(src, /FROM posts/);
  assert.doesNotMatch(yml, /SVIC_PLATFORM_DATABASE_URL/);
  assert.match(yml, /node scripts\/frontpage-guard\.mjs/);
  assert.match(src, /await openTask\(\{/);
});

test('стенд, вернувшийся внутри окна пересборки, карточку не открывает', async () => {
  let t = 0;
  const answers = [
    { reached: false, error: 'HTTP 502' },
    { reached: false, error: 'HTTP 503' },
    { reached: true, ok: true, checked: 136 },
  ];
  const out = await callThroat({ heal: async () => answers.shift(), sleep: async (ms) => { t += ms; }, now: () => t });
  assert.equal(out.reached, true);
  assert.equal(out.attempts, 3);
});

test('молчание дольше окна пересборки — и только оно — отказ', async () => {
  let t = 0;
  const out = await callThroat({ heal: async () => ({ reached: false, error: 'HTTP 502' }), sleep: async (ms) => { t += ms; }, now: () => t });
  assert.equal(out.reached, false);
  assert.ok(out.waitedMs >= REBUILD_WINDOW_MS);
});
