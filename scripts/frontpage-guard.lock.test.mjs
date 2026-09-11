import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./frontpage-guard.mjs', import.meta.url), 'utf8');
const yml = readFileSync(new URL('../.github/workflows/frontpage-guard.yml', import.meta.url), 'utf8');

test('сторож сначала лечит снимок, карточку ставит только если расхождение осталось', () => {
  assert.match(src, /\/api\/internal\/frontpage-refresh/);
  assert.match(src, /heal: true/);
  assert.match(src, /snapshotIsHealed\(healed\)/);
  assert.match(src, /siliconvalleyinvestclub\.com/);
  assert.doesNotMatch(src, /test\.siliconvalleyinvestclub\.com/);
  assert.match(src, /svic-frontpage-probe/);
  assert.match(yml, /node scripts\/frontpage-guard\.mjs/);
  assert.match(yml, /SVIC_HOST: https:\/\/siliconvalleyinvestclub\.com/);
  const healCall = src.indexOf('const healed = await healFrontpage()');
  const driftUse = src.lastIndexOf('await reportDrift');
  assert.ok(healCall > 0, 'лечение снимка должно быть в стороже');
  assert.ok(driftUse > healCall, 'карточка расхождения — после лечения снимка');
  assert.ok(src.indexOf('snapshotIsHealed(healed)') < driftUse);
  assert.match(src, /await openTask\(\{/);
});
