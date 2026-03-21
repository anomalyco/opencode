#!/usr/bin/env bash

set -euo pipefail

root="${DEPLOY_ROOT:?DEPLOY_ROOT is required}"
branch="${DEPLOY_BRANCH:?DEPLOY_BRANCH is required}"
sha="${DEPLOY_SHA:?DEPLOY_SHA is required}"
repo="${DEPLOY_REPO_URL:?DEPLOY_REPO_URL is required}"
compose_file="${DEPLOY_COMPOSE_FILE:?DEPLOY_COMPOSE_FILE is required}"
env_file="${DEPLOY_ENV_FILE:?DEPLOY_ENV_FILE is required}"

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

status() {
  docker compose -f "$compose_file" ps || true
}

logs() {
  docker compose -f "$compose_file" logs --tail=200 || true
}

fail() {
  echo "$1" >&2
  status
  logs
  exit 1
}

trap 'fail "deploy failed"' ERR

require git
require docker
require curl

mkdir -p "$(dirname "$root")"

if [ ! -d "$root/.git" ]; then
  git clone "$repo" "$root"
fi

cd "$root"

git remote set-url origin "$repo"
git fetch --prune --tags origin

git rev-parse --verify "$sha^{commit}" >/dev/null 2>&1 || fail "commit not found: $sha"
git rev-parse --verify "origin/$branch^{commit}" >/dev/null 2>&1 || fail "missing origin/$branch"
git merge-base --is-ancestor "$sha" "origin/$branch" || fail "commit is not in origin/$branch"

git checkout "$branch"
git reset --hard "$sha"
git clean -fdx -e deploy/vps-single-customer/.env

[ -f "$env_file" ] || fail "missing env file: $env_file"

set -a
. "$env_file"
set +a

user="${OPENCODE_SERVER_USERNAME:-opencode}"
url="${DEPLOY_HEALTHCHECK_URL:-https://${NUMERAL_DOMAIN}/global/health}"

docker compose -f "$compose_file" up -d --build --remove-orphans

curl \
  --fail \
  --silent \
  --show-error \
  --retry 10 \
  --retry-delay 3 \
  --retry-all-errors \
  --user "$user:$OPENCODE_SERVER_PASSWORD" \
  "$url"

status
echo "deployed $sha"
