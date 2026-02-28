#!/usr/bin/env bash
set -euo pipefail

states=(error final stream tool warning)

if [[ -z "${OPENCODE_SANDBOX_OPENAI_API_KEY:-}" && -z "${OPENCODE_SANDBOX_OPENAI_API_KEY_CMD:-}" ]]; then
  echo "Set OPENCODE_SANDBOX_OPENAI_API_KEY (or OPENCODE_SANDBOX_OPENAI_API_KEY_CMD) for non-error states."
fi

for state in "${states[@]}"; do
  export OPENCODE_SANDBOX_ROOT="/tmp/opencode-sandbox-${state}-$(date +%s)"
  export OPENCODE_SANDBOX_SESSION_NAME="opencode-sandbox-${state}-$(date +%s)"

  echo "\n==> Running state: $state"
  bash /home/choza/projects/opencode-source/.sisyphus/evidence/run-sandbox-tui.sh "$state"
done
