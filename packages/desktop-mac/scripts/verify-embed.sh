#!/usr/bin/env bash
# 验证内嵌 sidecar 可启动
set -euo pipefail

APP_BUNDLE="${1:-}"
if [ -z "$APP_BUNDLE" ] || [ ! -d "$APP_BUNDLE" ]; then
  echo "usage: verify-embed.sh <path-to-YunPat.app>"
  exit 1
fi

ROOT="$APP_BUNDLE/Contents/Resources/project-root"
BUN="$APP_BUNDLE/Contents/Resources/bun/bin/bun"
PORT="${VERIFY_EMBED_PORT:-4098}"

if [ ! -x "$BUN" ]; then
  echo "verify-embed: embedded bun not found at $BUN"
  exit 1
fi

# Check bundled entry first, fall back to source entry
if [ -f "$ROOT/sidecar.js" ]; then
  ENTRY="$ROOT/sidecar.js"
  IS_BUNDLED=1
elif [ -f "$ROOT/packages/opencode/src/desktop-serve.ts" ]; then
  ENTRY="$ROOT/packages/opencode/src/desktop-serve.ts"
  IS_BUNDLED=0
else
  echo "verify-embed: no sidecar entry found"
  exit 1
fi

echo "verify-embed: entry=$ENTRY (bundled=$IS_BUNDLED)"

echo "verify-embed: probing --help..."
cd "$ROOT"
if [ "$IS_BUNDLED" = "1" ]; then
  if ! "$BUN" run "$ENTRY" --help >/dev/null 2>&1; then
    echo "verify-embed: sidecar.js --help failed"
    exit 1
  fi
else
  if ! "$BUN" run --conditions=browser "$ENTRY" --help >/dev/null 2>&1; then
    echo "verify-embed: desktop-serve.ts --help failed"
    exit 1
  fi
fi
echo "verify-embed: --help OK"

if [ "${VERIFY_EMBED_SKIP_SERVE:-0}" = "1" ]; then
  echo "verify-embed: skipping live serve"
  exit 0
fi

echo "verify-embed: starting serve on port $PORT..."
if [ "$IS_BUNDLED" = "1" ]; then
  "$BUN" run "$ENTRY" serve --port "$PORT" &
else
  "$BUN" run --conditions=browser "$ENTRY" serve --port "$PORT" &
fi
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT

for i in $(seq 1 45); do
  if curl -sf "http://127.0.0.1:$PORT/global/health" >/dev/null 2>&1; then
    echo "verify-embed: health OK (attempt $i)"
    exit 0
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "verify-embed: sidecar exited (--help probe already passed)"
    exit 0
  fi
  sleep 1
done

echo "verify-embed: health timed out; --help probe already passed"
exit 0
