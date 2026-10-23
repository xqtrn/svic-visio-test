import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PUBLIC_CMS_ORIGIN,
  cmsOrigin,
  cmsCall,
  loadAssets,
  beginAsset,
  finishAsset,
  auditAsset,
} from '../remux-uploads.mjs';

// Замок бага: карточка #478a5455-10f7-4b55-ac1a-f53fc6f270eb
// Пост 3384, 2026-10-23: Publish → 409 video_card_copy_not_ready даже через час.
// Ролик Xona umvkvamyk-horizontal, мастер videos/umvkvamyk-horizontal.mp4,
// 39123359 байт. Прогон remux 39944118394 (11:09Z) умер на pg.Pool
// секретом SVIC_PLATFORM_DATABASE_URL: password authentication failed (28P01),
// строка 292, ещё до первой копии .720.mp4. CMS-маршрут уже был живой после
// выката ca969c3, но робот его не звал. Замок держит сам робот, не только API.

const XONA_ID = 'umvkvamyk-horizontal';
const XONA_KEY = 'videos/umvkvamyk-horizontal.mp4';
const XONA_MASTER_BYTES = 39123359;

const src = readFileSync(new URL('../remux-uploads.mjs', import.meta.url), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const workflow = readFileSync(new URL('../.github/workflows/remux-uploads.yml', import.meta.url), 'utf8');

test('робот поста 3384 не открывает скопированный пароль postgres', () => {
  assert.equal(PUBLIC_CMS_ORIGIN, 'https://siliconvalleyinvestclub.com');
  assert.doesNotMatch(code, /from 'pg'|new pg\.Pool|DATABASE_URL|SVIC_PLATFORM_DATABASE_URL/);
  assert.match(src, /\/api\/internal\/video-pipeline\/assets/);
  assert.match(workflow, /SVIC_INTERNAL_KEY/);
  assert.doesNotMatch(workflow, /SVIC_PLATFORM_DATABASE_URL|npm i pg/);
  assert.match(workflow, /node --test tests\/remux-uploads-live-cms\.test\.mjs/);
  assert.throws(() => cmsOrigin({ CMS_ORIGIN: 'https://svic-platform-production.up.railway.app' }), /Railway/);
  assert.equal(cmsOrigin({}), PUBLIC_CMS_ORIGIN);
});

test('строка umvkvamyk-horizontal читается у живого CMS, а не из пула', async () => {
  const calls = [];
  const call = async (method, path, body) => {
    calls.push({ method, path, body });
    assert.equal(method, 'GET');
    return { assets: [{ id: XONA_ID, object_key: XONA_KEY }] };
  };
  const assets = await loadAssets(call, XONA_ID);
  assert.deepEqual(assets, [{ id: XONA_ID, object_key: XONA_KEY }]);
  assert.equal(calls[0].path, `/api/internal/video-pipeline/assets?id=${XONA_ID}`);
});

test('обрыв пароля не превращается в пустой успешный список', async () => {
  const call = async () => {
    const error = new Error('password authentication failed for user "postgres"');
    error.status = 500;
    throw error;
  };
  await assert.rejects(() => loadAssets(call, XONA_ID), /password authentication failed/);
});

test('ход копии Xona пишет begin, finish и audit в тот же маршрут', async () => {
  const calls = [];
  const call = async (method, path, body) => {
    calls.push({ method, path, body });
    return { ok: true, id: XONA_ID };
  };
  await beginAsset(call, XONA_ID);
  await finishAsset(call, XONA_ID, {
    outcome: 'error',
    error: 'password authentication failed for user "postgres"',
  });
  await auditAsset(call, 'video.card-copy-ready', XONA_ID, { bytes: XONA_MASTER_BYTES, key: XONA_KEY.replace(/\.mp4$/, '.720.mp4') });
  assert.deepEqual(calls.map((item) => item.path), [
    `/api/internal/video-pipeline/assets/${XONA_ID}/begin`,
    `/api/internal/video-pipeline/assets/${XONA_ID}/finish`,
    '/api/internal/video-pipeline/audit',
  ]);
  assert.equal(calls[2].body.after.bytes, XONA_MASTER_BYTES);
  assert.equal(calls[1].body.outcome, 'error');
});

test('запрос к CMS несёт внутренний ключ и не кладёт пароль в адрес', async () => {
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, text: async () => '{"assets":[]}' };
  };
  await cmsCall(fetchImpl, {
    origin: PUBLIC_CMS_ORIGIN,
    key: 'live-cms-key',
    method: 'GET',
    path: `/api/internal/video-pipeline/assets?id=${XONA_ID}`,
  });
  assert.equal(seen.url, `${PUBLIC_CMS_ORIGIN}/api/internal/video-pipeline/assets?id=${XONA_ID}`);
  assert.equal(seen.init.headers['x-internal-key'], 'live-cms-key');
  assert.equal(JSON.stringify(seen).includes('postgres'), false);
  await assert.rejects(
    () => cmsCall(fetchImpl, { origin: PUBLIC_CMS_ORIGIN, key: '', method: 'GET', path: '/api/internal/video-pipeline/assets' }),
    /pipeline credentials missing/,
  );
});
