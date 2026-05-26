#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="${1:-$PWD}"

if [ ! -d "${TARGET_DIR}" ]; then
  echo "target dir is missing: ${TARGET_DIR}" >&2
  exit 1
fi

export PATH="$HOME/.bun/bin:$PATH"
export OPENCODE_DISABLE_AUTOUPDATE=1
export OPENCODE_DISABLE_CLAUDE_CODE=1
export OPENCODE_DISABLE_EXTERNAL_SKILLS=1
export OPENCODE_DISABLE_TERMINAL_TITLE=1

BUN_BIN="$(command -v bun || true)"
if [ -z "${BUN_BIN}" ]; then
  echo "bun not found in PATH" >&2
  exit 1
fi

printf '\033]0;%s\007' 'securecode'
cd "${SCRIPT_DIR}"
exec "${BUN_BIN}" run script/securecode-supervisor.ts "${TARGET_DIR}"
