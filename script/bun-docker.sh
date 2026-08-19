#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "" ]]; then
  cat <<'EOF'
Run Bun commands in Docker when Bun is not installed locally.

Usage:
  script/bun-docker.sh <bun-args...>

Examples:
  script/bun-docker.sh --version
  script/bun-docker.sh install
  script/bun-docker.sh run --cwd packages/tui test
  script/bun-docker.sh run --cwd packages/tui typecheck
EOF
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UID_GID="$(id -u):$(id -g)"
BUN_VERSION="$(sed -nE 's/.*"packageManager"[[:space:]]*:[[:space:]]*"bun@([^"]+)".*/\1/p' "$ROOT/package.json" | head -n1)"
if [[ "$BUN_VERSION" == "" ]]; then
  echo "Unable to determine Bun version from package.json packageManager field." >&2
  exit 1
fi

LOCAL_IMAGE="opencode-bun:${BUN_VERSION}-build"
BASE_IMAGE="oven/bun:${BUN_VERSION}"

TTY_ARGS=()
if [[ -t 0 && -t 1 ]]; then
  TTY_ARGS=("-it")
fi

if ! docker image inspect "$LOCAL_IMAGE" >/dev/null 2>&1; then
  docker build -t "$LOCAL_IMAGE" -f - "$ROOT" <<EOF
FROM ${BASE_IMAGE}
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ git \
  && rm -rf /var/lib/apt/lists/*
EOF
fi

exec docker run --rm "${TTY_ARGS[@]}" \
  --user "$UID_GID" \
  -e HOME=/tmp \
  -v "$ROOT:/workspaces/opencode" \
  -w /workspaces/opencode \
  "$LOCAL_IMAGE" bun "$@"
