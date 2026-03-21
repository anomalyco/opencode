#!/usr/bin/env bash
set -euo pipefail

log() {
  echo "[start-opencode-serve] $*"
}

log "source=/app/packages/veritly-components/examples.md"
log "user=$XDG_CONFIG_HOME/opencode/AGENTS.md"

mkdir -p /data/workspace
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_STATE_HOME"
mkdir -p /data/opencode-managed
{
  echo "# Veritly managed instructions"
  echo
  cat /app/packages/veritly-components/examples.md
  if [ -f "$XDG_CONFIG_HOME/opencode/AGENTS.md" ]; then
    echo
    echo "---"
    echo
    echo "# User instructions"
    echo
    cat "$XDG_CONFIG_HOME/opencode/AGENTS.md"
  fi
} > /data/opencode-managed/veritly-instructions.md
OPENCODE_CONFIG_CONTENT='{"instructions":["/data/opencode-managed/veritly-instructions.md"]}'
if [ -f /data/opencode-managed/veritly-instructions.md ]; then
  log "generated=/data/opencode-managed/veritly-instructions.md"
  log "bytes=$(wc -c < /data/opencode-managed/veritly-instructions.md)"
else
  log "failed to generate instructions file"
  exit 1
fi
if [ -f "$XDG_CONFIG_HOME/opencode/AGENTS.md" ]; then
  log "user-instructions=found"
else
  log "user-instructions=missing"
fi
log "opencode_config_content=$OPENCODE_CONFIG_CONTENT"

if [ ! -e /workspace ]; then
  ln -s /data/workspace /workspace
fi

cd /workspace

export OPENCODE_PROJECTS_ROOT=/workspace
export OPENCODE_CONFIG_CONTENT

log "starting opencode backend host=127.0.0.1 port=4096"
exec bun --cwd /app/packages/opencode src/index.ts serve --hostname 127.0.0.1 --port 4096
