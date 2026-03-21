#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
log() {
  echo "[start-opencode-dev-backend] $*"
}

log "root=$ROOT"
log "source=$ROOT/packages/veritly-components/examples.md"
log "user=$HOME/.config/opencode/AGENTS.md"

mkdir -p "$ROOT/.veritly/.managed-opencode"
{
  echo "# Veritly managed instructions"
  echo
  cat "$ROOT/packages/veritly-components/examples.md"
  if [ -f "$HOME/.config/opencode/AGENTS.md" ]; then
    echo
    echo "---"
    echo
    echo "# User instructions"
    echo
    cat "$HOME/.config/opencode/AGENTS.md"
  fi
} > "$ROOT/.veritly/.managed-opencode/veritly-instructions.md"

export OPENCODE_CONFIG_CONTENT="{\"instructions\":[\"$ROOT/.veritly/.managed-opencode/veritly-instructions.md\"]}"
if [ -f "$ROOT/.veritly/.managed-opencode/veritly-instructions.md" ]; then
  log "generated=$ROOT/.veritly/.managed-opencode/veritly-instructions.md"
  log "bytes=$(wc -c < "$ROOT/.veritly/.managed-opencode/veritly-instructions.md")"
else
  log "failed to generate instructions file"
  exit 1
fi
if [ -f "$HOME/.config/opencode/AGENTS.md" ]; then
  log "user-instructions=found"
else
  log "user-instructions=missing"
fi
log "opencode_config_content=$OPENCODE_CONFIG_CONTENT"
log "starting opencode backend on 4096"

bun_debug_args=()
if [ -n "${BUN_INSPECT_BRK:-}" ]; then
  bun_debug_args+=(--inspect-brk="$BUN_INSPECT_BRK")
elif [ -n "${BUN_INSPECT_WAIT:-}" ]; then
  bun_debug_args+=(--inspect-wait="$BUN_INSPECT_WAIT")
elif [ -n "${BUN_INSPECT:-}" ]; then
  bun_debug_args+=(--inspect="$BUN_INSPECT")
fi

if [ ${#bun_debug_args[@]} -gt 0 ]; then
  log "bun_debug=${bun_debug_args[*]}"
fi

exec bun run "${bun_debug_args[@]}" --cwd "$ROOT/packages/opencode" --conditions=browser ./src/index.ts serve --port 4096
