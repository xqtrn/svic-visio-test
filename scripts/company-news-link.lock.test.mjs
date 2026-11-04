import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const helper = path.join(here, 'company-news-link.py');
const workflow = readFileSync(new URL('../.github/workflows/company-news.yml', import.meta.url), 'utf8');

function py(code) {
  const r = spawnSync('python3', ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(here)}); from importlib.machinery import SourceFileLoader; m = SourceFileLoader('nlink', ${JSON.stringify(helper)}).load_module();\n${code}`], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout.trim();
}

test('Bing apiclick with HTML-entity &amp;url= unwraps to the publisher', () => {
  const encoded = 'http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=abc&amp;url=https%3a%2f%2fwww.prnewswire.com%2fnews-releases%2fcorgi-re.html&amp;c=1&amp;mkt=en-us';
  const got = py(`print(m.direct_link(${JSON.stringify(encoded)}))`);
  assert.equal(got, 'https://www.prnewswire.com/news-releases/corgi-re.html');
});

test('already-unescaped Bing apiclick still unwraps', () => {
  const raw = 'http://www.bing.com/news/apiclick.aspx?ref=FexRss&url=https%3a%2f%2freinsurancene.ws%2fcorgi%2f&c=1';
  const got = py(`print(m.direct_link(${JSON.stringify(raw)}))`);
  assert.equal(got, 'https://reinsurancene.ws/corgi/');
});

test('aggregator leftovers are dropped, publisher URLs kept', () => {
  assert.equal(py(`print(m.direct_link('https://news.google.com/rss/articles/ABC') or 'EMPTY')`), 'EMPTY');
  assert.equal(py(`print(m.direct_link('https://www.reinsurancene.ws/corgi-re/'))`), 'https://www.reinsurancene.ws/corgi-re/');
});

test('thin collect unions with the retained release instead of freezing it', () => {
  const got = py(`
fresh=[{'title':'Corgi Re','link':'https://www.prnewswire.com/corgi-re','ts':3}]
old=[{'title':'Old','link':'https://www.prnewswire.com/old','ts':1},{'title':'Corgi Re','link':'https://dup.example/corgi-re','ts':2}]
out=m.merge_items(fresh, old)
print(len(out), out[0]['title'], out[1]['title'])
`);
  assert.equal(got, '2 Corgi Re Old');
});

test('collector workflow uses the unwrap helper, not a raw &url= search on encoded XML', () => {
  assert.match(workflow, /scripts\/company-news-link\.py/);
  assert.match(workflow, /direct_link\(/);
});

test('a feed with the same stories is not uploaded again', () => {
  const old = "[{'title':'A','link':'https://x.example/a','ts':2},{'title':'B','link':'https://x.example/b','ts':1}]";
  assert.equal(py(`print(m.feed_unchanged(${old}, ${old}))`), 'True');
  assert.equal(py(`print(m.feed_unchanged([{'title':'New','link':'https://x.example/n','ts':3}] + ${old}, ${old}))`), 'False');
  assert.equal(py(`print(m.feed_unchanged(${old}, []))`), 'False');
});

function publishFixture(ghScript, feeds = 45) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cn-publish-'));
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  mkdirSync(path.join(dir, 'out'));
  for (let i = 0; i < feeds; i += 1) writeFileSync(path.join(dir, 'out', `c${i}.json`), '{}');
  writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env bash\necho "$*" >> ${dir}/gh.log\n${ghScript}\n`, { mode: 0o755 });
  writeFileSync(path.join(bin, 'nosleep'), `#!/usr/bin/env bash\necho "$1" >> ${dir}/sleep.log\n`, { mode: 0o755 });
  return { dir, bin };
}

function runPublish({ dir, bin }, maxWait) {
  return spawnSync('bash', [path.join(here, 'company-news-publish.sh'), path.join(dir, 'out'), path.join(dir, 'published'), String(maxWait)], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: 'x/y', PUBLISH_SLEEP_BIN: path.join(bin, 'nosleep') },
  });
}

const uploads = (dir) => readFileSync(path.join(dir, 'gh.log'), 'utf8').split('\n').filter((l) => l.startsWith('release upload'));

test('each feed goes out once: a second pass uploads nothing', () => {
  const fx = publishFixture('exit 0');
  assert.equal(runPublish(fx, 0).status, 0);
  assert.equal(readdirSync(path.join(fx.dir, 'published')).length, 45);
  assert.equal(readdirSync(path.join(fx.dir, 'out')).length, 0);
  const first = uploads(fx.dir).length;
  assert.equal(first, 3, 'uploaded in chunks of 20');
  assert.equal(runPublish(fx, 0).status, 0);
  assert.equal(uploads(fx.dir).length, first);
});

test('a batch pass without waiting keeps unsent feeds and reports failure', () => {
  const fx = publishFixture('[ "$1" = release ] && { echo "HTTP 403: API rate limit exceeded" >&2; exit 1; }; echo "0 9999999999"');
  assert.equal(runPublish(fx, 0).status, 1);
  assert.equal(readdirSync(path.join(fx.dir, 'out')).length, 45);
  assert.equal(existsSync(path.join(fx.dir, 'sleep.log')), false);
});

test('the final pass waits for the limit to reset, then finishes', () => {
  const now = Math.floor(Date.now() / 1000);
  const fx = publishFixture(`if [ "$1" = api ]; then echo "0 ${now + 600}"; exit 0; fi
n=$(grep -c '^release upload' "$(dirname "$(dirname "$0")")/gh.log")
[ "$n" -gt 1 ] && exit 0
echo "HTTP 403: API rate limit exceeded" >&2; exit 1`);
  const r = runPublish(fx, 3000);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readdirSync(path.join(fx.dir, 'published')).length, 45);
  const slept = Number(readFileSync(path.join(fx.dir, 'sleep.log'), 'utf8').trim());
  assert.ok(slept > 590 && slept <= 605, `slept ${slept}`);
});

test('the final pass fails honestly when the wait does not fit the job', () => {
  const now = Math.floor(Date.now() / 1000);
  const fx = publishFixture(`if [ "$1" = api ]; then echo "0 ${now + 3000}"; exit 0; fi
echo "HTTP 403: API rate limit exceeded" >&2; exit 1`);
  const r = runPublish(fx, 600);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /45 feeds not published/);
  assert.equal(readdirSync(path.join(fx.dir, 'out')).length, 45);
});

test('the workflow uploads only through the publisher', () => {
  const direct = workflow.split('\n').filter((l) => l.includes('gh release upload'));
  assert.deepEqual(direct, []);
  assert.match(workflow, /company-news-publish\.sh out published 0/);
  assert.match(workflow, /rm -f out\/\*\.json/);
});
