import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./frontpage-guard.mjs', import.meta.url), 'utf8');
const yml = readFileSync(new URL('../.github/workflows/frontpage-guard.yml', import.meta.url), 'utf8');

test('сторож сначала пересобирает главную, карточку ставит только если расхождение осталось', () => {
  assert.match(src, /\/api\/internal\/frontpage-refresh/);
  assert.match(src, /rebuildFrontpage/);
  assert.match(yml, /node scripts\/frontpage-guard\.mjs/);
  const openAt = src.indexOf('await openTask({');
  const driftOpen = src.indexOf("summary: head");
  const rebuildAt = src.indexOf('rebuildFrontpage()');
  assert.ok(rebuildAt > 0, 'пересборка должна быть в стороже');
  assert.ok(driftOpen > rebuildAt, 'карточка расхождения — после пересборки');
  assert.ok(openAt > 0);
});
