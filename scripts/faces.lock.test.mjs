import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

function py(code) {
  const r = spawnSync('python3', ['-c', `import sys, json; sys.path.insert(0, ${JSON.stringify(here)}); import faces_keys as k;\n${code}`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout.trim();
}
const PREFIX = 'siliconvalleyinvestclub.com/wp-content/uploads/';

test('every storage root reads the key the site worker looks up', () => {
  const key = (p) => py(`print(k.face_key(${JSON.stringify(p)}))`);
  assert.equal(key('/svic-media/1793784056090-fal-founders.png'), `${PREFIX}1793784056090-fal-founders.png`);
  assert.equal(key('/img/2026/02/kavak.png'), `${PREFIX}2026/02/kavak.png`);
  assert.equal(key('/e/uploads/2026/07/a.jpg'), `${PREFIX}2026/07/a.jpg`);
  assert.equal(key('/wp-content/uploads/2026/07/a.jpg'), `${PREFIX}2026/07/a.jpg`);
  assert.equal(key('/img/2025/04/%E2%80%8Eclara.jpeg'), `${PREFIX}2025/04/‎clara.jpeg`);
});

test('only our raster covers are scanned, with query and host dropped', () => {
  const cover = (s) => py(`print(k.cover_path(${JSON.stringify(s)}))`);
  assert.equal(cover('/svic-media/a.png?w=1280&v=2'), '/svic-media/a.png');
  assert.equal(cover('https://siliconvalleyinvestclub.com/img/2026/a.webp'), '/img/2026/a.webp');
  assert.equal(cover('/_skin/logo-air.svg'), 'None');
  assert.equal(cover('https://example.com/img/a.png'), 'None');
  assert.equal(cover('/svic-media/clip.mp4'), 'None');
  assert.equal(cover(''), 'None');
});

test('covers are found in the home page and in the list of posts', () => {
  const html = '<img src="/svic-media/1.png?w=1280&amp;v=2"><img src="/img/2026/02/k.png?w=800"><img src="/_skin/logo-air.svg">';
  const got = py(`print(json.dumps(sorted(k.paths_from_html(${JSON.stringify(html)}) | k.paths_from_posts([{'image':'/svic-media/2.jpg'},{'image':None},None]))))`);
  assert.deepEqual(JSON.parse(got), ['/img/2026/02/k.png', '/svic-media/1.png', '/svic-media/2.jpg']);
});

test('covers already mapped or seen without a face are not scanned again', () => {
  const got = py(`print(json.dumps(k.to_scan({'/img/old.png','/svic-media/none.png','/svic-media/new.png','/e/uploads/new.png'}, {k.KEY_PREFIX+'old.png', k.KEY_PREFIX+'none.png'})))`);
  assert.deepEqual(JSON.parse(got), { [`${PREFIX}new.png`]: '/e/uploads/new.png' });
});

test('the robot reads the public site and never the closed test host', () => {
  const src = readFileSync(new URL('../faces.py', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /test\.siliconvalleyinvestclub\.com/);
  assert.doesNotMatch(src, /edge-preview/);
  assert.doesNotMatch(src, /wp-json/);
  assert.match(src, /https:\/\/siliconvalleyinvestclub\.com/);
});

test('both published files go out together', () => {
  const yml = readFileSync(new URL('../.github/workflows/faces.yml', import.meta.url), 'utf8');
  assert.match(yml, /gh release upload faces faces\.json faces-seen\.json --clobber/);
});
