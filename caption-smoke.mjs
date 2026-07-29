#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import jwt from 'jsonwebtoken';
import { chromium, webkit } from 'playwright';

const BASE = String(process.env.BASE || 'https://test.siliconvalleyinvestclub.com').replace(/\/$/, '');
const API_BASE = String(process.env.API_BASE || BASE).replace(/\/$/, '');
const SECRET = process.env.PLATFORM_SESSION_SECRET || '';
const VIDEO_FILE = process.env.VIDEO_FILE || 'caption-smoke.mp4';
const OUT = path.resolve('out');
const HOST = new URL(BASE).hostname;

if (!SECRET) throw new Error('PLATFORM_SESSION_SECRET is required');
if (!fs.existsSync(VIDEO_FILE)) throw new Error(`video missing: ${VIDEO_FILE}`);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const token = jwt.sign(
  { userId: 'caption-smoke', role: 'admin', displayName: 'Caption smoke' },
  SECRET,
  { expiresIn: '70m' },
);
const cookieHeader = `svic_token=${token}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message) => console.log(`[caption-smoke] ${message}`);

async function request(route, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${API_BASE}${route}`, {
    method,
    redirect: 'manual',
    headers: {
      Cookie: cookieHeader,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { response, data };
}

async function expectJson(route, options = {}, expected = [200]) {
  const result = await request(route, options);
  if (!expected.includes(result.response.status)) {
    throw new Error(`${options.method || 'GET'} ${route}: HTTP ${result.response.status} ${String(result.data).slice(0, 220)}`);
  }
  return result.data;
}

async function waitForCaptions(id) {
  const deadline = Date.now() + 55 * 60_000;
  let previous = '';
  while (Date.now() < deadline) {
    const state = await expectJson(`/api/admin/video-status/${encodeURIComponent(id)}`);
    if (state.captions_status !== previous) {
      log(`caption state: ${state.captions_status}`);
      previous = state.captions_status;
    }
    if (state.captions_status === 'ready') return state;
    if (state.captions_status === 'ready_no_speech') throw new Error('recognizer returned ready_no_speech for speech fixture');
    if (state.captions_status === 'error') throw new Error(`caption worker failed: ${state.error || 'unknown error'}`);
    await sleep(10_000);
  }
  throw new Error('caption worker timeout');
}

async function waitForNewPlayer(page) {
  await page.waitForSelector('video.svic-video', { timeout: 45_000 });
  await page.locator('video.svic-video').first().evaluate((video) => {
    window.__captionSmokeMedia = [];
    const snapshot = (type) => window.__captionSmokeMedia.push({
      type,
      at: performance.now(),
      src: video.currentSrc || video.src,
      readyState: video.readyState,
      networkState: video.networkState,
      currentTime: video.currentTime,
      paused: video.paused,
      error: video.error ? { code: video.error.code, message: video.error.message } : null,
    });
    [
      'loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'playing', 'waiting',
      'stalled', 'suspend', 'abort', 'emptied', 'ended', 'error',
    ].forEach((type) => video.addEventListener(type, () => snapshot(type)));
    snapshot('attached');
  });
  await page.waitForSelector('.svic-cc-control', { timeout: 45_000 });
  await page.waitForFunction(() => {
    const video = document.querySelector('video.svic-video');
    const button = document.querySelector('.svic-cc-control');
    if (!video || !button || button.getAttribute('aria-pressed') !== 'true') return false;
    const track = [...video.textTracks].find((item) => item.kind === 'captions' || item.kind === 'subtitles');
    return Boolean(
      track
      && track.mode === 'hidden'
      && track.cues
      && track.cues.length
      && document.querySelector('.svic-caption-overlay'),
    );
  }, null, { timeout: 45_000 });
  await page.locator('.svic-cc-control').first().click();
  await page.waitForFunction(() => {
    const video = document.querySelector('video.svic-video');
    const button = document.querySelector('.svic-cc-control');
    const track = video && [...video.textTracks].find((item) => item.kind === 'captions' || item.kind === 'subtitles');
    const overlay = document.querySelector('.svic-caption-overlay');
    return Boolean(
      video
      && button?.getAttribute('aria-pressed') === 'false'
      && track?.mode === 'disabled'
      && overlay?.hidden,
    );
  }, null, { timeout: 10_000 });
  await page.locator('.svic-cc-control').first().click();
  await page.waitForFunction(() => {
    const video = document.querySelector('video.svic-video');
    const button = document.querySelector('.svic-cc-control');
    const track = video && [...video.textTracks].find((item) => item.kind === 'captions' || item.kind === 'subtitles');
    return Boolean(video && button?.getAttribute('aria-pressed') === 'true' && track?.mode === 'hidden');
  }, null, { timeout: 10_000 });
  await page.locator('video.svic-video').first().evaluate(async (video) => {
    const track = [...video.textTracks].find((item) => item.kind === 'captions' || item.kind === 'subtitles');
    video.currentTime = Math.max(0, (track?.cues?.[0]?.startTime || 0) + 0.05);
    await video.play().catch(() => {});
  });
  await page.locator('video.svic-video').first().scrollIntoViewIfNeeded();
  await page.locator('.cs-entry__overlay-bg').first().hover().catch(() => {});
  await page.waitForFunction(() => {
    const video = document.querySelector('video.svic-video');
    const overlay = document.querySelector('.svic-caption-overlay');
    const line = overlay?.querySelector('.svic-caption-line');
    if (!video || !overlay || overlay.hidden || !line?.textContent?.trim()) return false;
    const vr = video.getBoundingClientRect();
    const cr = overlay.getBoundingClientRect();
    const fontRatio = parseFloat(getComputedStyle(overlay).fontSize) / vr.width;
    const topRatio = (cr.top - vr.top) / vr.height;
    const bottomRatio = (cr.bottom - vr.top) / vr.height;
    const minFontRatio = vr.width <= 640 ? 0.04 : 0.025;
    return (
      topRatio >= 0.55
      && bottomRatio <= 0.9
      && fontRatio >= minFontRatio
      && fontRatio <= 0.075
      && getComputedStyle(line).backgroundColor === 'rgba(10, 23, 51, 0.86)'
    );
  }, null, { timeout: 15_000 });
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const video = document.querySelector('video.svic-video');
    const button = document.querySelector('.svic-cc-control');
    const track = [...video.textTracks].find((item) => item.kind === 'captions' || item.kind === 'subtitles');
    const overlay = document.querySelector('.svic-caption-overlay');
    const line = overlay.querySelector('.svic-caption-line');
    const vr = video.getBoundingClientRect();
    const cr = overlay.getBoundingClientRect();
    return {
      ccPressed: button.getAttribute('aria-pressed'),
      ccToggle: 'off-on',
      trackMode: track.mode,
      cueCount: track.cues ? track.cues.length : 0,
      trackSrc: video.querySelector('track')?.getAttribute('src') || '',
      captionOverlay: {
        lineCount: overlay.querySelectorAll('.svic-caption-line').length,
        topRatio: Number(((cr.top - vr.top) / vr.height).toFixed(3)),
        bottomRatio: Number(((cr.bottom - vr.top) / vr.height).toFixed(3)),
        fontSize: getComputedStyle(overlay).fontSize,
        fontToVideoWidth: Number((parseFloat(getComputedStyle(overlay).fontSize) / vr.width).toFixed(3)),
        background: getComputedStyle(line).backgroundColor,
      },
    };
  });
}

async function findLegacyPlayer(page, candidates) {
  for (const item of candidates.slice(0, 12)) {
    await page.goto(`${BASE}${item.u}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    try {
      await page.waitForSelector('video.svic-video', { timeout: 20_000 });
      await page.waitForFunction(() => {
        const video = document.querySelector('video.svic-video');
        return video && video.readyState >= 2;
      }, null, { timeout: 20_000 });
      const ccCount = await page.locator('.svic-cc-control').count();
      const trackCount = await page.locator('video.svic-video track').count();
      if (ccCount !== 0 || trackCount !== 0) {
        throw new Error(`legacy player changed: cc=${ccCount}, tracks=${trackCount}`);
      }
      await page.locator('video.svic-video').first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(700);
      return { id: item.v, url: item.u, ccCount, trackCount };
    } catch (error) {
      if (String(error.message || error).startsWith('legacy player changed')) throw error;
      log(`legacy candidate skipped: ${item.v}`);
    }
  }
  throw new Error('no playable legacy video found');
}

async function inspectEngine(engineName, browserType, articleUrl, legacyCandidates, contextOptions, launchOptions = {}) {
  const browser = await browserType.launch(launchOptions);
  try {
    const context = await browser.newContext(contextOptions);
    await context.addCookies([{ name: 'svic_token', value: token, domain: HOST, path: '/' }]);
    const page = await context.newPage();
    const errors = [];
    const mediaResponses = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('response', (response) => {
      if (response.url().includes('/svic-video/') || response.url().includes('/svic-captions/')) {
        mediaResponses.push({
          kind: 'response',
          status: response.status(),
          url: response.url(),
          contentType: response.headers()['content-type'] || '',
        });
      }
    });
    page.on('requestfailed', (request) => {
      if (request.url().includes('/svic-video/') || request.url().includes('/svic-captions/')) {
        mediaResponses.push({
          kind: 'requestfailed',
          url: request.url(),
          error: request.failure()?.errorText || '',
        });
      }
    });

    await page.goto(`${BASE}${articleUrl}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    let newPlayer;
    try {
      newPlayer = await waitForNewPlayer(page);
    } catch (error) {
      await page.screenshot({ path: path.join(OUT, `${engineName}-new-failure.png`), fullPage: true }).catch(() => {});
      fs.writeFileSync(path.join(OUT, `${engineName}-new-failure.html`), await page.content());
      const mediaDebug = await page.evaluate(() => window.__captionSmokeMedia || []).catch(() => []);
      throw new Error(
        `${error.message}\nmediaDebug=${JSON.stringify(mediaDebug)}\nmediaResponses=${JSON.stringify(mediaResponses)}`,
      );
    }
    await page.screenshot({ path: path.join(OUT, `${engineName}-new-viewport.png`) });
    await page.locator('video.svic-video').first().screenshot({ path: path.join(OUT, `${engineName}-new-player.png`) });

    const legacy = await findLegacyPlayer(page, legacyCandidates);
    await page.screenshot({ path: path.join(OUT, `${engineName}-legacy-viewport.png`) });
    await page.locator('video.svic-video').first().screenshot({ path: path.join(OUT, `${engineName}-legacy-player.png`) });

    // The imported legacy theme currently emits this unrelated minified runtime
    // error on otherwise-functional pages. Preserve it in the artifact, while
    // keeping the caption smoke strict for every other page error.
    const unexpectedErrors = errors.filter(
      (message) => !/TypeError: t\((?:\.\.\.)?\) is not a function/.test(message),
    );
    if (unexpectedErrors.length) {
      throw new Error(`${engineName} page errors: ${unexpectedErrors.join(' | ').slice(0, 500)}`);
    }
    return { engine: engineName, newPlayer, legacy, observedPageErrors: errors };
  } finally {
    await browser.close();
  }
}

let postId = null;
const result = {
  base: BASE,
  apiBase: API_BASE,
  startedAt: new Date().toISOString(),
  assertions: {},
  browsers: [],
};

try {
  const presign = await expectJson('/api/admin/video/presign', {
    method: 'POST',
    body: { filename: `caption-smoke-${Date.now()}.mp4` },
  });
  const bytes = fs.readFileSync(VIDEO_FILE);
  const upload = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4' },
    body: bytes,
  });
  if (!upload.ok) throw new Error(`S3 upload failed: HTTP ${upload.status}`);
  const uploaded = await expectJson('/api/admin/video/uploaded', {
    method: 'POST',
    body: { id: presign.id },
  });
  result.videoId = presign.id;
  result.assertions.pipelineStarted = uploaded.optimizing === true;
  if (!result.assertions.pipelineStarted) throw new Error('video pipeline dispatch did not start');

  const stamp = Date.now();
  const draft = await expectJson('/api/admin/posts', {
    method: 'POST',
    body: {
      slug: `caption-smoke-${stamp}`,
      title: `Caption smoke ${stamp}`,
      excerpt: 'Temporary automated caption verification.',
      content_html: '<p>Temporary automated caption verification.</p>',
      author: 'Caption smoke',
      published_at: new Date().toISOString(),
      status: 'draft',
      seo_meta: {},
      categories: [],
      tags: [],
    },
  }, [201]);
  postId = draft.id;

  const premature = await request(`/api/admin/posts/${postId}`, {
    method: 'PUT',
    body: { status: 'publish', video_id: presign.id },
  });
  if (premature.response.status === 409 && premature.data?.error === 'captions_not_ready') {
    result.assertions.publishGate = 'blocked-while-processing';
  } else if (premature.response.status === 200) {
    // A warm worker can finish this six-second fixture between upload and the
    // first publish request. A 200 is valid only if the asset is already ready.
    const raced = await expectJson(`/api/admin/video-status/${encodeURIComponent(presign.id)}`);
    if (!['ready', 'ready_no_speech'].includes(raced.captions_status)) {
      throw new Error(`publish gate failed: HTTP 200 while ${raced.captions_status}`);
    }
    result.assertions.publishGate = 'captions-ready-before-publish';
  } else {
    throw new Error(`publish gate failed: HTTP ${premature.response.status}`);
  }

  const ready = await waitForCaptions(presign.id);
  result.caption = {
    status: ready.captions_status,
    language: ready.captions_language,
    url: ready.caption_url,
  };
  const vtt = await fetch(`${BASE}${ready.caption_url}`, { headers: { Cookie: cookieHeader } });
  const vttText = await vtt.text();
  result.assertions.vttServed = vtt.ok && /^WEBVTT\s/m.test(vttText) && /captions/i.test(vttText);
  if (!result.assertions.vttServed) throw new Error(`VTT verification failed: HTTP ${vtt.status}`);

  const published = await expectJson(`/api/admin/posts/${postId}`, {
    method: 'PUT',
    body: { status: 'publish', video_id: presign.id },
  });
  result.articleUrl = published.permalink;

  const manifest = await expectJson(`/api/site/video-manifest?smoke=${stamp}`);
  const current = manifest.covers?.find((item) => item.v === presign.id);
  result.assertions.manifestHasCaption = current?.caption_url === `/svic-captions/${presign.id}.vtt`;
  if (!result.assertions.manifestHasCaption) throw new Error('caption metadata missing from video manifest');
  const legacyCandidates = [...(manifest.tv || []), ...(manifest.covers || [])]
    .filter((item, index, all) => !item.caption_url && all.findIndex((x) => x.v === item.v) === index);
  if (!legacyCandidates.length) throw new Error('legacy regression fixture missing');

  const desktopResult = await inspectEngine(
    'desktop-chromium',
    chromium,
    published.permalink,
    legacyCandidates,
    { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    // Playwright's bundled Linux Chromium does not ship proprietary H.264/AAC
    // codecs. GitHub's Google Chrome does, matching the production browser.
    { channel: 'chrome' },
  );
  result.browsers.push(desktopResult);
  const desktopLegacy = legacyCandidates.find((item) => item.v === desktopResult.legacy.id);
  const mobileLegacyCandidates = desktopLegacy
    ? [desktopLegacy, ...legacyCandidates.filter((item) => item.v !== desktopLegacy.v)]
    : legacyCandidates;
  result.browsers.push(await inspectEngine(
    'mobile-webkit',
    webkit,
    published.permalink,
    mobileLegacyCandidates,
    {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    },
  ));
  result.ok = true;
} catch (error) {
  result.ok = false;
  result.error = String(error.stack || error);
  throw error;
} finally {
  if (postId !== null) {
    await request(`/api/admin/posts/${postId}`, { method: 'DELETE' }).catch(() => {});
    await request('/api/admin/frontpage/refresh', { method: 'POST', body: {} }).catch(() => {});
  }
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));
}
