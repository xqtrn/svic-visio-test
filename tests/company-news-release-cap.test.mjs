// Замок бага: карточка #b6169c55-5e39-4266-90ca-11e0accd706a
// One release asset per company hits the hard asset cap. The next company, under
// any name, then fails the scheduled publish. The repair must accept every name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const publisher = path.join(here, '..', 'scripts', 'company-news-publish.sh');

function feed(slug) {
  return JSON.stringify({
    slug,
    items: Array.from({ length: 8 }, (_, n) => ({
      title: `${slug} story ${n}`,
      link: `https://example.com/${slug}/${n}`,
    })),
  });
}

function run(slugs, ghScript, maxWait = 600) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cn-cap-'));
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  mkdirSync(path.join(dir, 'out'));
  for (const slug of slugs) writeFileSync(path.join(dir, 'out', `${slug}.json`), feed(slug));
  writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env bash\necho "$*" >> ${dir}/gh.log\n${ghScript}\n`, { mode: 0o755 });
  writeFileSync(path.join(bin, 'nosleep'), `#!/usr/bin/env bash\necho "$1" >> ${dir}/sleep.log\n`, { mode: 0o755 });
  const result = spawnSync('bash', [publisher, path.join(dir, 'out'), path.join(dir, 'published'), String(maxWait)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_REPOSITORY: 'x/y',
      SHARD: '0',
      SHARDS: '1',
      PUBLISH_SLEEP_BIN: path.join(bin, 'nosleep'),
    },
  });
  const log = existsSync(path.join(dir, 'gh.log')) ? readFileSync(path.join(dir, 'gh.log'), 'utf8') : '';
  return { dir, result, log };
}

const CAP = '[ "$2" = upload ] && { echo "HTTP 422: Validation Failed" >&2; echo "file_count limited to 1000 assets per release" >&2; exit 1; }; exit 0';

test('Случай карточки: лента без своего ассета не ждёт у потолка релиза', () => {
  const { dir, result } = run(['varo'], CAP);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /permanent release asset limit/);
  assert.equal(existsSync(path.join(dir, 'sleep.log')), false);
  assert.equal(readdirSync(path.join(dir, 'out')).includes('varo.json'), true);
});

test('Другой случай класса: другое имя у того же потолка останавливается так же', () => {
  const { dir, result, log } = run(['westwell'], CAP);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /permanent release asset limit/);
  assert.equal(existsSync(path.join(dir, 'sleep.log')), false);
  assert.equal(readdirSync(path.join(dir, 'out')).includes('westwell.json'), true);
  assert.equal(log.split('\n').filter((line) => line.startsWith('release upload')).length, 1);
});

test('Нормальный случай: партия ниже потолка уходит одним bundle, не файлом на имя', () => {
  const fx = run(['varo', 'westwell'], 'exit 0', 0);
  assert.equal(fx.result.status, 0, fx.result.stderr);
  assert.deepEqual(readdirSync(path.join(fx.dir, 'out')), []);
  const upload = fx.log.split('\n').find((line) => line.startsWith('release upload'));
  assert.match(upload, /shard-0\.json/);
  assert.match(upload, /manifest\.json/);
  assert.doesNotMatch(upload, /varo\.json/);
  const bundle = JSON.parse(readFileSync(path.join(fx.dir, 'published', '.company-news-bundle.json'), 'utf8'));
  assert.equal(bundle.varo.slug, 'varo');
  assert.equal(bundle.westwell.items.length, 8);
  assert.equal(bundle.varo.items[0].link.startsWith('https://example.com/'), true);
});
