import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ytId, probeVerdict, probeIsBlind } from './archive-clips-lib.mjs';

test('only real YouTube ids are sent to YouTube', () => {
  assert.equal(ytId('y9UTFs4fCQU'), 'y9UTFs4fCQU');
  assert.equal(ytId('6PuTL4D3_I8'), '6PuTL4D3_I8');
  assert.equal(ytId('https://www.youtube.com/watch?v=OPFBkRRjNkY&t=3'), 'OPFBkRRjNkY');
  assert.equal(ytId('https://youtu.be/XM2Xb9QuS2A'), 'XM2Xb9QuS2A');
  assert.equal(ytId('https://www.youtube.com/embed/hPDQpBAvY_Y'), 'hPDQpBAvY_Y');
});

test('our own library ids are not YouTube ids', () => {
  for (const id of ['mediatw6', 'media2gcf', 'media3aig', 'umvzevr0j-horizontal', 'umugnepms-horizontal', 'media12345z', '', null]) {
    assert.equal(ytId(id), null, String(id));
  }
});

test('a file is missing only on 404', () => {
  assert.equal(probeVerdict(206, 'video/mp4'), 'have');
  assert.equal(probeVerdict(200, 'video/mp4'), 'have');
  assert.equal(probeVerdict(404, 'text/plain'), 'missing');
  assert.equal(probeVerdict(403, 'text/html'), 'unknown');
  assert.equal(probeVerdict(200, 'text/html'), 'unknown', 'a login page is not a video');
  assert.equal(probeVerdict(undefined, undefined), 'unknown');
});

test('a probe that cannot see the site stops the run', () => {
  assert.equal(probeIsBlind(8, 8), true);
  assert.equal(probeIsBlind(4, 8), true);
  assert.equal(probeIsBlind(1, 8), false);
  assert.equal(probeIsBlind(0, 0), false);
});

test('the robot looks at the public site, not the closed test host', () => {
  const src = readFileSync(new URL('../archive-missing-clips.mjs', import.meta.url), 'utf8');
  assert.match(src, /process\.env\.SVIC_HOST \|\| 'https:\/\/siliconvalleyinvestclub\.com'/);
  assert.doesNotMatch(src, /test\.siliconvalleyinvestclub\.com/);
  assert.doesNotMatch(src, /edge-preview/);
});
