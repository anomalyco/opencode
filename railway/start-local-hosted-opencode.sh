#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_ROOT="$ROOT/.veritly"
WORKSPACE_ROOT="$DATA_ROOT/workspace"
BACKEND_PORT="${OPENCODE_BACKEND_PORT:-4096}"
PUBLIC_PORT="${PORT:-4097}"
BACKEND_USERNAME="${OPENCODE_SERVER_USERNAME:-opencode}"
BACKEND_PASSWORD="${OPENCODE_SERVER_PASSWORD:-testpass}"
log() {
  echo "[start-local-hosted-opencode] $*"
}

log "root=$ROOT"
log "data_root=$DATA_ROOT"
log "workspace_root=$WORKSPACE_ROOT"
log "source=$ROOT/packages/veritly-components/examples.md"
log "user=$DATA_ROOT/.config/opencode/AGENTS.md"

mkdir -p "$WORKSPACE_ROOT" "$DATA_ROOT/.config" "$DATA_ROOT/.cache" "$DATA_ROOT/.local/share" "$DATA_ROOT/.local/state"

mkdir -p "$DATA_ROOT/.managed-opencode"
{
  echo "# Veritly managed instructions"
  echo
  cat "$ROOT/packages/veritly-components/examples.md"
  if [ -f "$DATA_ROOT/.config/opencode/AGENTS.md" ]; then
    echo
    echo "---"
    echo
    echo "# User instructions"
    echo
    cat "$DATA_ROOT/.config/opencode/AGENTS.md"
  fi
} > "$DATA_ROOT/.managed-opencode/veritly-instructions.md"
OPENCODE_CONFIG_CONTENT="{\"instructions\":[\"$DATA_ROOT/.managed-opencode/veritly-instructions.md\"]}"
if [ -f "$DATA_ROOT/.managed-opencode/veritly-instructions.md" ]; then
  log "generated=$DATA_ROOT/.managed-opencode/veritly-instructions.md"
  log "bytes=$(wc -c < "$DATA_ROOT/.managed-opencode/veritly-instructions.md")"
else
  log "failed to generate instructions file"
  exit 1
fi
if [ -f "$DATA_ROOT/.config/opencode/AGENTS.md" ]; then
  log "user-instructions=found"
else
  log "user-instructions=missing"
fi
log "opencode_config_content=$OPENCODE_CONFIG_CONTENT"

cleanup() {
  kill "$backend_pid" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

cd "$ROOT"
log "building hosted app"
bun run build:veritly-hosted

(
  cd "$WORKSPACE_ROOT"
  log "starting backend host=127.0.0.1 port=$BACKEND_PORT"
  XDG_DATA_HOME="$DATA_ROOT/.local/share" \
    XDG_CONFIG_HOME="$DATA_ROOT/.config" \
    XDG_CACHE_HOME="$DATA_ROOT/.cache" \
    XDG_STATE_HOME="$DATA_ROOT/.local/state" \
    HOME="$DATA_ROOT" \
    OPENCODE_TEST_HOME="$DATA_ROOT" \
    OPENCODE_CONFIG_CONTENT="$OPENCODE_CONFIG_CONTENT" \
    OPENCODE_PROJECTS_ROOT="$WORKSPACE_ROOT" \
    OPENCODE_SERVER_USERNAME="$BACKEND_USERNAME" \
    OPENCODE_SERVER_PASSWORD="$BACKEND_PASSWORD" \
    bun --cwd "$ROOT/packages/opencode" --watch src/index.ts serve --hostname 127.0.0.1 --port "$BACKEND_PORT"
) &
backend_pid=$!

for _ in $(seq 1 30); do
  if curl -fsS -u "$BACKEND_USERNAME:$BACKEND_PASSWORD" "http://127.0.0.1:$BACKEND_PORT/global/health" >/dev/null 2>&1; then
    log "backend health=ok"
    log "starting custom app public_port=$PUBLIC_PORT"
    exec env \
      PORT="$PUBLIC_PORT" \
      OPENCODE_SERVER_USERNAME="$BACKEND_USERNAME" \
      OPENCODE_SERVER_PASSWORD="$BACKEND_PASSWORD" \
      OPENCODE_APP_DIST_DIR="$ROOT/packages/app/dist" \
      bun "$ROOT/railway/serve-custom-app.mjs"
  fi
  sleep 1
done

log "backend health=failed after 30 checks"
exit 1
