#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export OCU_CONFIG="${OCU_CONFIG:-$HOME/.config/ocu/config.json}"
export OCU_HOST="${OCU_HOST:-127.0.0.1}"
export OCU_PORT="${OCU_PORT:-8787}"

if [[ ! -f "$OCU_CONFIG" ]]; then
  echo "OCU config not found: $OCU_CONFIG" >&2
  echo "Run ocu/android/setup-termux.sh first." >&2
  exit 1
fi

exec node "$ROOT/ocu/gateway/gateway.mjs"
