#!/usr/bin/env bash

backend_username="${OPENCODE_SERVER_USERNAME:-opencode}"
backend_password="${OPENCODE_SERVER_PASSWORD:-}"

if [ -z "$backend_password" ]; then
  echo "WARNING: Starting without authentication. Set OPENCODE_SERVER_PASSWORD for production." >&2
fi

export OPENCODE_PROJECTS_ROOT=/workspace

echo "Starting opencode..."
exec bun --cwd /app/packages/opencode src/hosted.ts