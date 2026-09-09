#!/usr/bin/env bash
# Repair apt on GitHub-hosted Ubuntu so Playwright / ffmpeg install does not die
# on a hash mismatch in ANY configured source (Azure Ubuntu mirror OR a
# third-party repo the runner image ships, e.g. Google Chrome).
#
# 2026-09-09: ui-audit runs 34385979522/34386086818/34386212533 failed at
# `npx playwright install --with-deps webkit` with apt exit 100 — "Some index
# files failed to download", hash mismatch on azure.archive.ubuntu.com AND
# dl.google.com/linux/chrome-stable. The page was never opened.
set -euo pipefail

repo_root() {
  if [ -n "${GITHUB_WORKSPACE:-}" ]; then
    printf '%s\n' "$GITHUB_WORKSPACE"
    return
  fi
  cd "$(dirname "$0")/../../.." && pwd
}

# Recurrence lock: workflows must not call apt-get update or
# `playwright install --with-deps` themselves. Both go through this throat
# (repair-apt / install-playwright). A copy pasted next to the action is how
# the class came back last time.
assert_workflows_use_throat() {
  local wf hits
  wf="$(repo_root)/.github/workflows"
  [ -d "$wf" ] || return 0
  hits="$(grep -RInE --include='*.yml' --include='*.yaml' \
    'apt-get.*update|playwright install --with-deps' "$wf" || true)"
  if [ -n "$hits" ]; then
    printf '%s\n' "$hits" >&2
    echo "ERR: raw apt-get update / playwright install --with-deps is forbidden; use ./.github/actions/repair-apt or install-playwright" >&2
    return 1
  fi
}

drop_google_chrome_sources() {
  # GH ubuntu-latest ships google-chrome.list. A hash mismatch there fails
  # `apt-get update` even when we only wanted WebKit system libraries.
  sudo rm -f \
    /etc/apt/sources.list.d/google-chrome.list \
    /etc/apt/sources.list.d/google-chrome.sources \
    /etc/apt/sources.list.d/google.list \
    /etc/apt/sources.list.d/google-chrome.list.save \
    2>/dev/null || true
}

drop_microsoft_prod_sources() {
  sudo rm -f \
    /etc/apt/sources.list.d/microsoft-prod.list \
    /etc/apt/sources.list.d/microsoft-prod.sources \
    2>/dev/null || true
}

switch_azure_mirror() {
  # Noble runners use mirror+file:/etc/apt/apt-mirrors.txt, not only sources.list.
  # The prescribed sed on sources.list* is kept; apt-mirrors.txt is the one the
  # runner actually reads (log: "Get:1 file:/etc/apt/apt-mirrors.txt Mirrorlist").
  sudo sed -i 's/azure.archive.ubuntu.com/archive.ubuntu.com/g' \
    /etc/apt/sources.list \
    /etc/apt/sources.list.save \
    /etc/apt/apt-mirrors.txt \
    /etc/apt/sources.list.d/* \
    2>/dev/null || true
}

clean_lists() {
  sudo rm -rf /var/lib/apt/lists/*
  sudo apt-get clean >/dev/null 2>&1 || true
}

apt_update() {
  sudo apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 update
}

assert_workflows_use_throat

drop_google_chrome_sources
clean_lists

if apt_update; then
  exit 0
fi

echo "apt update failed — retry after cleaning lists"
clean_lists
if apt_update; then
  exit 0
fi

echo "apt update failed again — switching Azure Ubuntu mirror to archive.ubuntu.com"
switch_azure_mirror
clean_lists
if apt_update; then
  exit 0
fi

echo "apt update failed after mirror switch — dropping microsoft-prod too"
drop_microsoft_prod_sources
clean_lists
apt_update
