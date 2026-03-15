#!/usr/bin/env bash
set -euo pipefail

mkdir -p /data/workspace
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_STATE_HOME"

if [ ! -e /workspace ]; then
  ln -s /data/workspace /workspace
fi

cd /workspace

exec bun --cwd /app/packages/opencode src/index.ts web --hostname 0.0.0.0 --port "${PORT:-3000}"
