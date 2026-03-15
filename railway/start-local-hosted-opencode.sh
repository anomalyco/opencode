#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_ROOT="$ROOT/.veritly"
WORKSPACE_ROOT="$DATA_ROOT/workspace"
BACKEND_PORT="${OPENCODE_BACKEND_PORT:-4096}"
PUBLIC_PORT="${PORT:-4097}"
BACKEND_USERNAME="${OPENCODE_SERVER_USERNAME:-opencode}"
BACKEND_PASSWORD="${OPENCODE_SERVER_PASSWORD:-testpass}"

mkdir -p "$WORKSPACE_ROOT" "$DATA_ROOT/.config" "$DATA_ROOT/.cache" "$DATA_ROOT/.local/share" "$DATA_ROOT/.local/state"

cleanup() {
  kill "$backend_pid" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

cd "$ROOT"
bun run build:veritly-hosted

(
  cd "$WORKSPACE_ROOT"
  XDG_DATA_HOME="$DATA_ROOT/.local/share" \
    XDG_CONFIG_HOME="$DATA_ROOT/.config" \
    XDG_CACHE_HOME="$DATA_ROOT/.cache" \
    XDG_STATE_HOME="$DATA_ROOT/.local/state" \
    HOME="$DATA_ROOT" \
    OPENCODE_TEST_HOME="$DATA_ROOT" \
    OPENCODE_PROJECTS_ROOT="$WORKSPACE_ROOT" \
    OPENCODE_SERVER_USERNAME="$BACKEND_USERNAME" \
    OPENCODE_SERVER_PASSWORD="$BACKEND_PASSWORD" \
    bun --cwd "$ROOT/packages/opencode" src/index.ts serve --hostname 127.0.0.1 --port "$BACKEND_PORT"
) &
backend_pid=$!

for _ in $(seq 1 30); do
  if curl -fsS -u "$BACKEND_USERNAME:$BACKEND_PASSWORD" "http://127.0.0.1:$BACKEND_PORT/global/health" >/dev/null 2>&1; then
    exec env \
      PORT="$PUBLIC_PORT" \
      OPENCODE_SERVER_USERNAME="$BACKEND_USERNAME" \
      OPENCODE_SERVER_PASSWORD="$BACKEND_PASSWORD" \
      OPENCODE_APP_DIST_DIR="$ROOT/packages/app/dist" \
      bun "$ROOT/railway/serve-custom-app.mjs"
  fi
  sleep 1
done

echo "OpenCode backend failed to become healthy" >&2
exit 1
