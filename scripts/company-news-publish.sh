#!/usr/bin/env bash
# Publishes collected company-news feeds to the release, each feed once per run.
#
# Why this exists (company-news red since 2026-10-09). The collector re-sent ALL
# feeds gathered so far at every checkpoint (20, 40, ... 120, then all again), so
# one run of 6 shards made ~3200 uploads, two requests each, against the 5000
# requests per hour GitHub gives this token. With 124 companies per shard the
# budget ran out near the end of the run. A file whose old copy was
# already deleted but whose new copy hit the limit vanished from the site until
# the next run (evidation, fal-ai, 2026-11-04).
#
# Usage: company-news-publish.sh <out-dir> <published-dir> [max-wait-seconds]
#   Sent feeds move to <published-dir>, so nothing is uploaded twice. On failure
#   the unsent ones stay in <out-dir>. With max-wait-seconds > 0 the script waits
#   for the limit to reset and retries; it exits 1 only when time runs out.
set -u
shopt -s nullglob

OUT=$1
DONE=$2
MAX_WAIT=${3:-0}
REPO=${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}
TAG=${RELEASE_TAG:-company-news}
CHUNK=${PUBLISH_CHUNK:-20}
SLEEP_BIN=${PUBLISH_SLEEP_BIN:-sleep}

mkdir -p "$DONE"
waited=0

# Seconds until the limit lets us back in; 60 for a failure that is not the limit.
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
  if gh release upload "$TAG" "${batch[@]}" -R "$REPO" --clobber; then
    mv -f "${batch[@]}" "$DONE"/
    echo "published ${#batch[@]} feeds, $(( ${#files[@]} - ${#batch[@]} )) left in this pass"
    continue
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
