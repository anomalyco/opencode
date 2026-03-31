#!/usr/bin/env bash

set -euo pipefail

api_port="${CONDUCTOR_PORT:-4096}"
web_port="$((api_port + 1))"
workspace_root="$PWD"
admin_email="${OPENCODE_BOOTSTRAP_ADMIN_EMAIL:-admin@numeral.local}"
admin_password="${OPENCODE_BOOTSTRAP_ADMIN_PASSWORD:-numeral123}"
lnko_path="$PWD/lnko"

cleanup() {
  if [ -n "${api_pid:-}" ]; then
    kill "$api_pid" 2>/dev/null || true
  fi

  if [ -n "${web_pid:-}" ]; then
    kill "$web_pid" 2>/dev/null || true
  fi

  wait "${api_pid:-}" "${web_pid:-}" 2>/dev/null || true
}

trap cleanup EXIT HUP INT TERM

echo "Starting Numeral (hosted mode)"
echo "API: http://localhost:${api_port}"
echo "App: http://localhost:${web_port}"
echo "Admin: ${admin_email} / ${admin_password}"
echo "Workspace root: ${workspace_root}"

OPENCODE_WORKSPACES_ROOT="$workspace_root" \
OPENCODE_BOOTSTRAP_ADMIN_EMAIL="$admin_email" \
OPENCODE_BOOTSTRAP_ADMIN_PASSWORD="$admin_password" \
bun run --cwd packages/opencode --conditions=browser src/index.ts serve --port "$api_port" &
api_pid=$!

# Wait for the API to be ready
echo "Waiting for API..."
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${api_port}/user/me" \
    -u "opencode:opencode" >/dev/null 2>&1; then
    echo "API ready"
    break
  fi
  if ! kill -0 "$api_pid" 2>/dev/null; then
    echo "API process died"
    exit 1
  fi
  sleep 1
done

# Login as admin and register lnko workspace
if [ -d "$lnko_path" ]; then
  cookie_jar=$(mktemp)
  trap "rm -f $cookie_jar; cleanup" EXIT HUP INT TERM

  curl -sf "http://localhost:${api_port}/user/login" \
    -u "opencode:opencode" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${admin_email}\",\"password\":\"${admin_password}\"}" \
    -c "$cookie_jar" >/dev/null

  curl -sf "http://localhost:${api_port}/workspace" \
    -u "opencode:opencode" \
    -H "Content-Type: application/json" \
    -b "$cookie_jar" \
    -d "{\"name\":\"lnko\",\"path\":\"${lnko_path}\"}" >/dev/null \
    && echo "Workspace 'lnko' registered at ${lnko_path}" \
    || echo "Warning: failed to register lnko workspace (may already exist)"

  rm -f "$cookie_jar"
fi

VITE_OPENCODE_SERVER_HOST="127.0.0.1" \
VITE_OPENCODE_SERVER_PORT="$api_port" \
bun run --cwd packages/app dev -- --host 0.0.0.0 --port "$web_port" &
web_pid=$!

status=0

while true; do
  if ! kill -0 "$api_pid" 2>/dev/null; then
    wait "$api_pid" || status=$?
    break
  fi

  if ! kill -0 "$web_pid" 2>/dev/null; then
    wait "$web_pid" || status=$?
    break
  fi

  sleep 1
done

exit "$status"
