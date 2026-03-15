#!/usr/bin/env bash
set -euo pipefail

/usr/local/bin/start-opencode-serve > /tmp/opencode-backend.log 2>&1 &
backend_pid=$!
backend_username="${OPENCODE_SERVER_USERNAME:-opencode}"
backend_password="${OPENCODE_SERVER_PASSWORD:-}"

cleanup() {
  kill "$backend_pid" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

for _ in $(seq 1 30); do
  if [ -n "$backend_password" ]; then
    if curl -fsS -u "$backend_username:$backend_password" http://127.0.0.1:4096/global/health >/dev/null 2>&1; then
      exec bun /usr/local/bin/serve-custom-app.mjs
    fi
  elif curl -fsS http://127.0.0.1:4096/global/health >/dev/null 2>&1; then
    exec bun /usr/local/bin/serve-custom-app.mjs
  fi
  sleep 1
done

echo "OpenCode backend failed to become healthy" >&2
cat /tmp/opencode-backend.log >&2 || true
exit 1
