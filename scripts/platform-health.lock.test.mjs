import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PUBLIC_ORIGIN, JWT_SIGN_OPTIONS, checkAdminPosts } from './platform-health.mjs';

test('сторож ходит на публичный сайт, не на закрытый Railway-origin', () => {
  assert.equal(PUBLIC_ORIGIN, 'https://siliconvalleyinvestclub.com');
  assert.doesNotMatch(PUBLIC_ORIGIN, /railway\.app/);
  const yml = readFileSync(new URL('../.github/workflows/platform-health.yml', import.meta.url), 'utf8');
  assert.match(yml, /node scripts\/platform-health\.mjs/);
  assert.doesNotMatch(yml, /svic-platform-production\.up\.railway\.app/);
});

test('JWT пробы несёт issuer/audience платформы', () => {
  assert.equal(JWT_SIGN_OPTIONS.issuer, 'svic-platform');
  assert.equal(JWT_SIGN_OPTIONS.audience, 'svic-platform');
  assert.equal(JWT_SIGN_OPTIONS.algorithm, 'HS256');
});

test('не-200 админки не маскируется под пустую выдачу', async () => {
  const fake = async () => ({ status: 404, json: async () => ({ total: 0 }) });
  const msg = await checkAdminPosts(fake, 'https://siliconvalleyinvestclub.com', 'tok', { retries: 0 });
  assert.equal(msg, '/api/admin/posts: HTTP 404');
  assert.doesNotMatch(msg, /total=0/);
});

test('одиночный transient 502 не становится карточкой', async () => {
  let calls = 0;
  const fake = async () => {
    calls += 1;
    if (calls === 1) return { status: 502, text: async () => 'upstream error' };
    return { status: 200, json: async () => ({ total: 1300 }) };
  };
  const msg = await checkAdminPosts(fake, 'https://siliconvalleyinvestclub.com', 'tok', { retries: 2, retryDelayMs: 1 });
  assert.equal(msg, null);
  assert.equal(calls, 2);
});

test('подтверждённый не-200 несёт число попыток и тело ответа', async () => {
  const fake = async () => ({ status: 502, text: async () => '<html>Bad gateway\ncloudflare</html>' });
  const msg = await checkAdminPosts(fake, 'https://siliconvalleyinvestclub.com', 'tok', { retries: 1, retryDelayMs: 1 });
  assert.match(msg, /^\/api\/admin\/posts: HTTP 502 \(2 попытки\) — ответ: /);
  assert.match(msg, /cloudflare/);
});

test('company-news читает каталог с публичного сайта', () => {
  const yml = readFileSync(new URL('../.github/workflows/company-news.yml', import.meta.url), 'utf8');
  assert.match(yml, /https:\/\/siliconvalleyinvestclub\.com\/api\/site\/companies/);
  assert.doesNotMatch(yml, /svic-platform-production\.up\.railway\.app\/api\/site\/companies/);
});

test('готовность статьи меряется по content_html, не по снимку', () => {
  const src = readFileSync(new URL('./platform-health.mjs', import.meta.url), 'utf8');
  assert.match(src, /content_html IS NULL OR content_html=''/);
  assert.doesNotMatch(src, /full_html IS NULL OR full_html=''/);
  assert.match(src, /страница свежей статьи не открывается/);
});
