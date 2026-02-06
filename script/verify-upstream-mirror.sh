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

if [[ "${right}" != "0" ]]; then
  echo "parent-dev has commits missing from upstream/dev: upstream/dev...origin/parent-dev = ${counts}" >&2
  echo "Refusing to continue because this is unsafe mirror drift." >&2
  exit 1
fi

if [[ "${left}" != "0" ]]; then
  echo "parent-dev is stale by ${left} commit(s): upstream/dev...origin/parent-dev = ${counts}"
  echo "Continuing: sync-upstream will force-refresh parent-dev from upstream/dev."
  exit 0
fi

echo "parent-dev mirror verified: upstream/dev...origin/parent-dev = ${counts}"
