#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

if [[ -z "${PREFIX:-}" || "${PREFIX}" != *com.termux* ]]; then
  echo "Run this script inside Termux." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG_DIR="$HOME/.config/ocu"
CONFIG_FILE="$CONFIG_DIR/config.json"

pkg update -y
pkg install -y nodejs-lts

mkdir -p "$CONFIG_DIR"
if [[ ! -f "$CONFIG_FILE" ]]; then
  cp "$ROOT/ocu/gateway/config.example.json" "$CONFIG_FILE"
  echo "Created $CONFIG_FILE from the example."
  echo "Edit provider URLs, model IDs and apiKeyEnv values before starting."
else
  echo "Keeping existing configuration: $CONFIG_FILE"
fi

echo
echo "Setup complete. Start OCU with:"
echo "  bash $ROOT/ocu/android/run-termux.sh"
