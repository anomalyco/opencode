#!/usr/bin/env bash
# Stop stale voxcode / voice-sidecar / opencode processes, rebuild the local
# voxcode bundle (voxcode + opencode + voice-sidecar), then print run commands.
#
# Usage (from anywhere):
#   /path/to/opencode/scripts/voxcode-local.sh
#
# Optional:
#   VOXCODE_VOICE_PORT=8765   sidecar port to free before build (default 8765)
#   VOXCODE_SKIP_OPENCODE=1   rebuild voxcode only (reuse last opencode binary)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VOICE_PORT="${VOXCODE_VOICE_PORT:-8765}"
STATE_DIR="${XDG_STATE_HOME:-"$HOME/.local/state"}/opencode"

kill_port() {
  local port="$1"
  local pids=""
  pids="$(lsof -ti:"$port" 2>/dev/null || true)"
  if [ -z "$pids" ]; then
    return 0
  fi
  echo "→ stopping port $port (pid $pids)"
  kill $pids 2>/dev/null || true
  sleep 0.3
  kill -9 $pids 2>/dev/null || true
}

echo "== voxcode local rebuild =="
echo

echo "1) Stopping previous voice / opencode processes"
kill_port "$VOICE_PORT"

if [ -f "$STATE_DIR/server.json" ]; then
  server_url="$(python3 -c "
import json, sys
try:
    print(json.load(open(sys.argv[1])).get('url', ''))
except Exception:
    pass
" "$STATE_DIR/server.json" 2>/dev/null || true)"
  if [[ "$server_url" =~ :([0-9]+)(/|$) ]]; then
    kill_port "${BASH_REMATCH[1]}"
  fi
fi

if command -v pkill >/dev/null 2>&1; then
  pkill -f "[v]oice_sidecar.*serve" 2>/dev/null || true
  pkill -f "[v]oxcode.*web" 2>/dev/null || true
fi

echo
echo "2) Building opencode (embedded web UI)"
if [ "${VOXCODE_SKIP_OPENCODE:-}" = "1" ]; then
  echo "   skipped (VOXCODE_SKIP_OPENCODE=1)"
else
  bun run --cwd "$ROOT/packages/opencode" build --single
fi

echo
echo "3) Building voxcode bundle"
if [ "${VOXCODE_SKIP_OPENCODE:-}" = "1" ]; then
  bun run --cwd "$ROOT/packages/voxcode" build --single --skip-opencode
else
  bun run --cwd "$ROOT/packages/voxcode" build --single
fi

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$os" in
  darwin) os=darwin ;;
  linux) os=linux ;;
  msys*|mingw*|cygwin*) os=windows ;;
esac

arch="$(uname -m)"
case "$arch" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64) arch=x64 ;;
esac

DIST="$ROOT/packages/voxcode/dist/voxcode-${os}-${arch}"
BIN="$DIST/bin"
VOXCODE="$BIN/voxcode"

if [ ! -x "$VOXCODE" ]; then
  echo "error: expected binary at $VOXCODE" >&2
  exit 1
fi

echo
echo "== build done =="
echo "   $DIST"
echo

if [ -z "${XAI_API_KEY:-}" ]; then
  echo "note: XAI_API_KEY is not set — export it before using voice."
  echo
fi

cat <<EOF
Run these commands:

  export PATH="$BIN:\$PATH"
  export XAI_API_KEY="xai-…"   # if not already set

  voxcode web                  # browser UI + voice (recommended)
  voxcode                      # terminal UI + voice
  voxcode tui ./your-project   # TUI in a project directory

Optional checks:

  curl -s http://127.0.0.1:${VOICE_PORT}/health | python3 -m json.tool
  open http://127.0.0.1:${VOICE_PORT}/voice/test

EOF
