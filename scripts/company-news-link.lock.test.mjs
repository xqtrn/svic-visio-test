import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
