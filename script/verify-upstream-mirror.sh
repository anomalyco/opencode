#!/usr/bin/env bash
set -euo pipefail

REMOTE_UPSTREAM="upstream"
REMOTE_ORIGIN="origin"
UPSTREAM_REPO_URL="https://github.com/anomalyco/opencode.git"
UPSTREAM_BRANCH="dev"
PARENT_BRANCH="parent-dev"

if ! git remote get-url "${REMOTE_UPSTREAM}" >/dev/null 2>&1; then
  git remote add "${REMOTE_UPSTREAM}" "${UPSTREAM_REPO_URL}"
fi

git fetch "${REMOTE_UPSTREAM}" "${UPSTREAM_BRANCH}"
git fetch "${REMOTE_ORIGIN}" "${PARENT_BRANCH}"

counts="$(git rev-list --left-right --count ${REMOTE_UPSTREAM}/${UPSTREAM_BRANCH}...${REMOTE_ORIGIN}/${PARENT_BRANCH})"
left="${counts%%[[:space:]]*}"
right="${counts##*[[:space:]]}"

if [[ "${left}" != "0" || "${right}" != "0" ]]; then
  echo "parent-dev mirror drift detected: upstream/dev...origin/parent-dev = ${counts}" >&2
  exit 1
fi

echo "parent-dev mirror verified: upstream/dev...origin/parent-dev = ${counts}"
