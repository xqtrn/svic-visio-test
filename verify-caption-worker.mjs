#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('./remux-uploads.mjs', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('./.github/workflows/remux-uploads.yml', import.meta.url), 'utf8');

assert.match(worker, /FROM video_assets/);
assert.doesNotMatch(worker, /prefix=videos\/u/, 'must not sweep legacy S3 objects');
assert.match(worker, /caption-transcribe\.py/);
assert.match(worker, /faster-whisper/);
assert.match(worker, /captions_status='ready'/);
assert.match(worker, /captions_status='error'/);
assert.match(worker, /captions_status='ready_no_speech'/);
assert.match(worker, /captions\/\$\{id\}\.vtt/);
assert.match(workflow, /repository_dispatch/);
assert.match(workflow, /faster-whisper/);
assert.match(workflow, /VIDEO_ID/);

console.log('caption worker contract: PASS');
