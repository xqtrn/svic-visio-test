import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PUBLIC_ORIGIN,
  JWT_SIGN_OPTIONS,
  checkAdminPosts,
  checkOriginStatus,
  checkSiteVersion,
  checkMediaFile,
  checkRecentMedia,
  readJsonResponse,
  isCmsAuthRejection,
  assertCmsSchema,
} from './platform-health.mjs';

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

test('/api/status не парсится слепым .json()', () => {
  const src = readFileSync(new URL('./platform-health.mjs', import.meta.url), 'utf8');
  assert.match(src, /checkOriginStatus/);
  assert.match(src, /HTML вместо JSON/);
  assert.doesNotMatch(src, /fetch\(ORIGIN \+ '\/api\/status'\)\)\.json\(\)/);
  assert.doesNotMatch(src, /await ver\.json\(\)/);
});

test('HTML на /api/status не становится Unexpected token', async () => {
  const html = { status: 200, headers: { get: () => 'text/html' }, text: async () => '<!DOCTYPE html><html><title>Error</title></html>' };
  const read = await readJsonResponse(html);
  assert.equal(read.kind, 'html');
  const msg = await checkOriginStatus(async () => html, 'https://siliconvalleyinvestclub.com', { retries: 0 });
  assert.match(msg, /\/api\/status: HTTP 200 HTML вместо JSON/);
  assert.match(msg, /<!DOCTYPE/);
  assert.doesNotMatch(msg, /Unexpected token/);
});

test('одиночный HTML на /api/status не становится карточкой', async () => {
  let calls = 0;
  const fake = async () => {
    calls += 1;
    if (calls === 1) {
      return { status: 200, headers: { get: () => 'text/html' }, text: async () => '<!DOCTYPE html>challenge' };
    }
    return { status: 200, headers: { get: () => 'application/json' }, text: async () => '{"ok":true,"db":true}' };
  };
  const msg = await checkOriginStatus(fake, 'https://siliconvalleyinvestclub.com', { retries: 2, retryDelayMs: 1 });
  assert.equal(msg, null);
  assert.equal(calls, 2);
});

test('подтверждённый HTML на /api/status несёт сниппет ответа', async () => {
  const fake = async () => ({
    status: 502,
    headers: { get: () => 'text/html' },
    text: async () => '<!DOCTYPE html><html>cloudflare</html>',
  });
  const msg = await checkOriginStatus(fake, 'https://siliconvalleyinvestclub.com', { retries: 1, retryDelayMs: 1 });
  assert.match(msg, /\/api\/status: HTTP 502 HTML вместо JSON \(2 попытки\)/);
  assert.match(msg, /cloudflare/);
});

test('200 HTML на админке подтверждается повторами, а не JSON.parse', async () => {
  let calls = 0;
  const fake = async () => {
    calls += 1;
    if (calls === 1) {
      return { status: 200, text: async () => '<!DOCTYPE html><title>SVIC — Login</title>' };
    }
    return { status: 200, json: async () => ({ total: 1300 }) };
  };
  const msg = await checkAdminPosts(fake, 'https://siliconvalleyinvestclub.com', 'tok', { retries: 2, retryDelayMs: 1 });
  assert.equal(msg, null);
  assert.equal(calls, 2);
});

test('версия сайта тоже не падает на HTML', async () => {
  const fake = async () => ({ status: 200, text: async () => '<!DOCTYPE html>error' });
  const msg = await checkSiteVersion(fake, 'https://siliconvalleyinvestclub.com', { retries: 0 });
  assert.match(msg, /\/api\/site\/__version: HTTP 200 HTML вместо JSON/);
  assert.doesNotMatch(msg, /Unexpected token/);
});

function mediaOk() {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'image/png' },
    arrayBuffer: async () => new ArrayBuffer(1024),
  };
}

function mediaFail(status) {
  return {
    ok: false,
    status,
    headers: { get: () => '' },
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

test('одиночный 522 медиатеки не становится карточкой', async () => {
  let calls = 0;
  const fake = async () => {
    calls += 1;
    if (calls === 1) return mediaFail(522);
    return mediaOk();
  };
  const msg = await checkMediaFile(
    fake,
    'https://siliconvalleyinvestclub.com',
    '/svic-media/logo.png',
    { retries: 2, retryDelayMs: 1 },
  );
  assert.equal(msg, null);
  assert.equal(calls, 2);
});

test('подтверждённый 522 медиатеки — отказ края, не пустой бакет', async () => {
  const fake = async () => mediaFail(522);
  const msg = await checkMediaFile(
    fake,
    'https://siliconvalleyinvestclub.com',
    '/svic-media/logo.png',
    { retries: 1, retryDelayMs: 1 },
  );
  assert.match(msg, /^край сайта не отдал картинку: \/svic-media\/logo\.png \(HTTP 522 \(2 попытки\), 0 байт\)$/);
  assert.doesNotMatch(msg, /хранилище картинок/);
});

test('404 медиатеки остаётся поломкой хранилища', async () => {
  const fake = async () => mediaFail(404);
  const msg = await checkMediaFile(
    fake,
    'https://siliconvalleyinvestclub.com',
    '/svic-media/missing.png',
    { retries: 0 },
  );
  assert.match(msg, /^хранилище картинок не отдаёт файл: \/svic-media\/missing\.png \(HTTP 404, 0 байт\)$/);
});

test('первая живая картинка из трёх достаточна только если все отвечают', async () => {
  const fake = async (url) => {
    if (String(url).includes('dead.png')) return mediaFail(404);
    return mediaOk();
  };
  const msg = await checkRecentMedia(
    fake,
    'https://siliconvalleyinvestclub.com',
    ['/svic-media/ok.png', '/svic-media/dead.png'],
    { retries: 0 },
  );
  assert.match(msg, /dead\.png/);
});

test('проба медиатеки ходит через checkMediaFile с повторами, не одним fetch', () => {
  const src = readFileSync(new URL('./platform-health.mjs', import.meta.url), 'utf8');
  assert.match(src, /checkMediaFile/);
  assert.match(src, /checkRecentMedia\(fetch, ORIGIN/);
  assert.match(src, /MEDIA_EDGE_STATUSES/);
  assert.doesNotMatch(src, /problems\.push\(`хранилище картинок не отдаёт файл: \$\{u\} \(HTTP \$\{r\.status\}/);
});

test('401 JSON auth_required — отказ датчика, не падение CMS', async () => {
  const fake = async () => ({
    status: 401,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ error: 'auth_required' }),
  });
  const msg = await checkAdminPosts(fake, 'https://siliconvalleyinvestclub.com', 'tok', { retries: 0 });
  assert.equal(msg, null);
  assert.equal(isCmsAuthRejection({
    status: 401,
    kind: 'json',
    payload: { error: 'auth_required' },
  }), true);
});

test('403 JSON admin_only тоже отказ датчика', async () => {
  const fake = async () => ({
    status: 403,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ error: 'admin_only' }),
  });
  const msg = await checkAdminPosts(fake, 'https://siliconvalleyinvestclub.com', 'tok', { retries: 0 });
  assert.equal(msg, null);
});

test('401 HTML на админке остаётся поломкой края', async () => {
  const fake = async () => ({
    status: 401,
    headers: { get: () => 'text/html' },
    text: async () => '<!DOCTYPE html><title>Unauthorized</title>',
  });
  const msg = await checkAdminPosts(fake, 'https://siliconvalleyinvestclub.com', 'tok', { retries: 0 });
  assert.match(msg, /\/api\/admin\/posts: HTTP 401/);
  assert.equal(isCmsAuthRejection({
    status: 401,
    kind: 'html',
    payload: null,
    snippet: '<!DOCTYPE html>',
  }), false);
});

test('чужая БД не маскируется под relation does not exist', async () => {
  const pool = {
    query: async () => ({ rows: [{ db: 'railway', has_posts: false, has_media: false }] }),
  };
  const msg = await assertCmsSchema(pool);
  assert.match(msg, /не на базу CMS/);
  assert.match(msg, /database=railway/);
  assert.doesNotMatch(msg, /does not exist/);
});

test('схема CMS с posts и media проходит', async () => {
  const pool = {
    query: async () => ({ rows: [{ db: 'svic_platform', has_posts: true, has_media: true }] }),
  };
  assert.equal(await assertCmsSchema(pool), null);
});

test('проба сначала проверяет схему CMS, не бьёт в posts/media вслепую', () => {
  const src = readFileSync(new URL('./platform-health.mjs', import.meta.url), 'utf8');
  assert.match(src, /assertCmsSchema/);
  assert.match(src, /isCmsAuthRejection/);
  assert.match(src, /to_regclass\('public\.posts'\)/);
  assert.match(src, /to_regclass\('public\.media'\)/);
});
