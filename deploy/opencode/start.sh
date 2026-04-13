#!/usr/bin/env bash
set -euo pipefail

backend_username="${OPENCODE_SERVER_USERNAME:-opencode}"
backend_password="${OPENCODE_SERVER_PASSWORD:-}"

if [ -z "$backend_password" ]; then
  echo "OPENCODE_SERVER_PASSWORD is required; refusing to start an unsecured hosted OpenCode instance." >&2
  exit 1
fi

mkdir -p /data/workspace
cd /data/workspace

export OPENCODE_PROJECTS_ROOT=/workspace

# Start the OpenCode backend only (relay is a separate service now)
exec bun --cwd /app/packages/opencode src/index.ts serve --port "${PORT:-3000}" --hostname 0.0.0.0
