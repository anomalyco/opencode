#!/usr/bin/env bash

set -euo pipefail

api_port="${CONDUCTOR_PORT:-4096}"
web_port="$((api_port + 1))"

cleanup() {
  [ -n "${api_pid:-}" ] && kill "$api_pid" 2>/dev/null || true
  [ -n "${web_pid:-}" ] && kill "$web_pid" 2>/dev/null || true
  wait "${api_pid:-}" "${web_pid:-}" 2>/dev/null || true
}

trap '' HUP
trap cleanup EXIT INT TERM

# Kill stale processes on our ports
for port in "$api_port" "$web_port"; do
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "Killing stale process on port ${port}"
    echo "$pids" | xargs kill 2>/dev/null || true
    sleep 1
  fi
done

echo "Starting Numeral"
echo "  API: http://localhost:${api_port}"
echo "  Web: http://localhost:${web_port}"

# Start API — use root "dev" script + pass serve args (dev:server hardcodes port 4096)
bun run dev -- serve --port "$api_port" 2>&1 &
api_pid=$!

# Wait for API
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${api_port}/global/health" >/dev/null 2>&1; then
    echo "API ready on port ${api_port}"
    break
  fi
  if ! kill -0 "$api_pid" 2>/dev/null; then
    echo "API process died"
    exit 1
  fi
  sleep 1
done

# Start web — pass port dynamically
VITE_OPENCODE_SERVER_HOST="127.0.0.1" \
VITE_OPENCODE_SERVER_PORT="$api_port" \
bun run dev:web -- --host 0.0.0.0 --port "$web_port" 2>&1 &
web_pid=$!

# Wait for either to exit
while kill -0 "$api_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do
  sleep 2
done
