import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WF_DIR = join(ROOT, '.github/workflows');
const WORKFLOWS = readdirSync(WF_DIR).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

// The lock guards GitHub-hosted machines, whose apt mirror flakes and killed
// browser installs. A workflow that runs ONLY on our own Railway runner
// (runs-on: [self-hosted, ...], Debian, root) never touches that mirror, so it
// is outside this lock. 2026-09-26: remux-uploads.yml moved to ci-runner and
// its one-time ffmpeg install red-lined every ui-audit run — the iOS WebKit
// gate of all platform deploys stood dead from 09-25.
function githubHosted(text) {
  const runsOn = [...text.matchAll(/^\s*runs-on:\s*(.+)$/gm)].map((m) => m[1]);
  return runsOn.length === 0 || runsOn.some((v) => !/self-hosted/.test(v));
}

test('self-hosted-only workflows are outside the lock; GitHub-hosted ones are not', () => {
  assert.equal(githubHosted('jobs:\n  a:\n    runs-on: [self-hosted, svic]\n'), false);
  assert.equal(githubHosted('jobs:\n  a:\n    runs-on: ubuntu-latest\n'), true);
  assert.equal(githubHosted('jobs:\n  a:\n    runs-on: [self-hosted, svic]\n  b:\n    runs-on: ubuntu-latest\n'), true);
});

test('ни один workflow не вызывает сырой apt-get update или playwright --with-deps', () => {
  const hits = [];
  for (const name of WORKFLOWS) {
    const text = read(`.github/workflows/${name}`);
    if (!githubHosted(text)) continue;
    if (/apt-get[^\n]*update/.test(text) || /playwright install --with-deps/.test(text)) {
      hits.push(name);
    }
  }
  assert.deepEqual(hits, []);
});

test('ui-audit ставит WebKit через кэш и горло, не через сырой apt', () => {
  const yml = read('.github/workflows/ui-audit.yml');
  assert.match(yml, /\.\/\.github\/actions\/install-playwright/);
  assert.match(yml, /browsers:\s*webkit/);
  assert.match(yml, /scripts\/apt-install-throat\.test\.mjs/);
});

test('горло кэширует браузер по версии Playwright и чинит зеркало Ubuntu', () => {
  const action = read('.github/actions/install-playwright/action.yml');
  assert.match(action, /actions\/cache@v4/);
  assert.match(action, /playwright-version/);
  assert.match(action, /~\/\.cache\/ms-playwright/);
  assert.match(action, /npx playwright install /);
  assert.doesNotMatch(action, /npx playwright install --with-deps/);

  const sh = read('.github/actions/repair-apt/repair-apt.sh');
  assert.match(sh, /Acquire::Retries=3/);
  assert.match(sh, /azure\.archive\.ubuntu\.com/);
  assert.match(sh, /archive\.ubuntu\.com/);
  assert.match(sh, /google-chrome/);
  assert.match(sh, /apt-mirrors\.txt/);
});

test('каждый playwright-install workflow идёт через горло', () => {
  const must = [
    'ui-audit.yml',
    'ios.yml',
    'visio.yml',
    'vault-ios.yml',
    'dsshot.yml',
    'card-shot.yml',
    'caption-smoke.yml',
    'artshot.yml',
    'messenger-program-test.yml',
    'messenger-window-test.yml',
  ];
  for (const name of must) {
    const text = read(`.github/workflows/${name}`);
    assert.match(text, /\.\/\.github\/actions\/install-playwright/, name);
  }
});

test('ffmpeg-workflow чинит apt до install, а не зовёт update сам', () => {
  const must = [
    'convert.yml',
    'download-missing.yml',
    'downscale.yml',
    'variants.yml',
    'archive-clips.yml',
    'interview-full.yml',
    'iv-covers.yml',
    'remux-uploads.yml',
    'caption-smoke.yml',
  ];
  for (const name of must) {
    const text = read(`.github/workflows/${name}`);
    if (!githubHosted(text)) continue; // our Railway runner: no GitHub apt mirror to repair
    assert.match(text, /\.\/\.github\/actions\/repair-apt|\.\/\.github\/actions\/install-playwright/, name);
    assert.doesNotMatch(text, /apt-get[^\n]*update/, name);
  }
});
