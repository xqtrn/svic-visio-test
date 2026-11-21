#!/usr/bin/env bash
# Publish one stable shard bundle.
#
# One asset per company filled the release to GitHub's hard cap of 1000 assets.
# The upload then returns HTTP 422 "file_count limited to 1000 assets per release"
# and waiting cannot make room. Every company in this shard shares one bundle
# asset, so the asset count follows the shard count, not the catalog. A rate
# limit still waits until the job budget ends. The asset cap does not.
#
# Usage: company-news-publish.sh <out-dir> <published-dir> [max-wait-seconds]
#   Sent feeds move to <published-dir>. Unsent feeds stay in <out-dir>.
#   Exit 2: the release refused the upload because it cannot grow.
set -u
shopt -s nullglob

OUT=$1
DONE=$2
MAX_WAIT=${3:-0}
REPO=${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}
TAG=${RELEASE_TAG:-company-news-v2}
SHARD=${SHARD:-0}
SHARDS=${SHARDS:-6}
ASSET="shard-${SHARD}.json"
CHUNK=${PUBLISH_CHUNK:-20}
SLEEP_BIN=${PUBLISH_SLEEP_BIN:-sleep}
BUNDLE="$DONE/.company-news-bundle.json"
STAGE="$DONE/.staging/$ASSET"
MANIFEST="$DONE/.staging/manifest.json"
ERR="$DONE/.upload-error"

mkdir -p "$DONE/.staging"
waited=0

# A failed download of an existing bundle is fatal: starting from {} would
# drop companies this shard already published.
if [ ! -f "$BUNDLE" ]; then
  asset_names=$(gh release view "$TAG" -R "$REPO" --json assets --jq '.assets[].name') || exit 1
  if printf '%s\n' "$asset_names" | grep -Fxq "$ASSET"; then
    gh release download "$TAG" -R "$REPO" -p "$ASSET" -D "$DONE/.staging" || exit 1
    mv "$STAGE" "$BUNDLE"
  else
    printf '{}\n' > "$BUNDLE"
  fi
fi

retry_pause() {
  local state remaining reset now
  state=$(gh api rate_limit --jq '.resources.core | "\(.remaining) \(.reset)"' 2>/dev/null) || state=''
  remaining=${state%% *}
  reset=${state##* }
  now=$(date +%s)
  if [[ "$remaining" =~ ^[0-9]+$ && "$reset" =~ ^[0-9]+$ && "$remaining" -lt 50 && "$reset" -gt "$now" ]]; then
    echo $((reset - now + 5))
  else
    echo 60
  fi
}

while :; do
  files=("$OUT"/*.json)
  [ "${#files[@]}" -eq 0 ] && exit 0
  batch=("${files[@]:0:$CHUNK}")
  python3 - "$BUNDLE" "$STAGE" "$MANIFEST" "$SHARD" "$SHARDS" "${batch[@]}" <<'PY' || exit 1
import datetime, hashlib, json, os, sys
current, stage, manifest, shard, shards, *paths = sys.argv[1:]
with open(current) as fh:
    feeds = json.load(fh)
if not isinstance(feeds, dict):
    raise SystemExit('published shard bundle is not an object')
now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
span, mine = int(shards), int(shard)
for path in paths:
    slug = os.path.basename(path)[:-5]
    if hashlib.sha256(slug.encode()).digest()[0] % span != mine:
        raise SystemExit(f'{slug} belongs to a different shard')
    with open(path) as fh:
        feed = json.load(fh)
    items = feed.get('items') if isinstance(feed, dict) else None
    if not isinstance(feed, dict) or feed.get('slug') != slug or not isinstance(items, list) or len(items) < 8:
        raise SystemExit(f'{slug} has no valid feed')
    feeds[slug] = {**feed, 'updated_at': now}
with open(stage, 'w') as fh:
    json.dump(feeds, fh, separators=(',', ':'))
with open(manifest, 'w') as fh:
    json.dump({'shards': span}, fh, separators=(',', ':'))
PY
  if gh release upload "$TAG" "$STAGE" "$MANIFEST" -R "$REPO" --clobber 2>"$ERR"; then
    mv -f "$STAGE" "$BUNDLE"
    mv -f "${batch[@]}" "$DONE"/
    rm -f "$ERR"
    echo "published ${#batch[@]} feeds in $ASSET, $(( ${#files[@]} - ${#batch[@]} )) left in this pass"
    continue
  fi
  cat "$ERR" >&2
  if grep -q 'file_count limited to 1000 assets per release' "$ERR"; then
    echo "permanent release asset limit; stop instead of retrying" >&2
    exit 2
  fi
  pause=$(retry_pause)
  if [ $((waited + pause)) -gt "$MAX_WAIT" ]; then
    echo "${#files[@]} feeds not published: next try in ${pause}s, waited ${waited}s of ${MAX_WAIT}s" >&2
    exit 1
  fi
  echo "upload failed, retrying in ${pause}s (${#files[@]} feeds left)" >&2
  "$SLEEP_BIN" "$pause"
  waited=$((waited + pause))
done
