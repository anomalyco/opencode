#!/usr/bin/env bash
set -euo pipefail

backend_username="${OPENCODE_SERVER_USERNAME:-opencode}"
backend_password="${OPENCODE_SERVER_PASSWORD:-}"
relay_port="${UNIVER_SDK_PORT:-18766}"

if [ -z "$backend_password" ]; then
  echo "OPENCODE_SERVER_PASSWORD is required; refusing to start an unsecured hosted OpenCode instance." >&2
  exit 1
fi

/usr/local/bin/start-opencode-serve > /tmp/opencode-backend.log 2>&1 &
backend_pid=$!
/usr/local/bin/bun /app/packages/univer-sdk/script/sdk-relay.ts > /tmp/univer-sdk-relay.log 2>&1 &
relay_pid=$!

cleanup() {
  kill "$backend_pid" 2>/dev/null || true
  kill "$relay_pid" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

for _ in $(seq 1 30); do
  if curl -fsS -u "$backend_username:$backend_password" http://127.0.0.1:4096/global/health >/dev/null 2>&1 \
    && curl -fsS "http://127.0.0.1:${relay_port}/health" >/dev/null 2>&1; then
    exec bun /usr/local/bin/serve-custom-app.mjs
  fi
  sleep 1
done

echo "OpenCode backend or relay failed to become healthy" >&2
cat /tmp/opencode-backend.log >&2 || true
cat /tmp/univer-sdk-relay.log >&2 || true
exit 1
