#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NCC_ENV_FILE="/Users/tkrk/Documents/Acompany/coding-agent-prototype/coding-agent-benchmark/ncc/.env"
DEFAULT_GPT_API_KEY="BzT0Xk2C23fdWCfJ8fQPStS7kiN7oqEgBFyTbJ5pHeo="
TARGET_DIR="${1:-$PWD}"

if [ ! -d "${TARGET_DIR}" ]; then
  echo "target dir is missing: ${TARGET_DIR}" >&2
  exit 1
fi

if [ -f "${NCC_ENV_FILE}" ]; then
  # shellcheck disable=SC1090
  source "${NCC_ENV_FILE}"
fi

if [ -z "${DEMO_GPT_OSS_120B_API_KEY:-}" ]; then
  export DEMO_GPT_OSS_120B_API_KEY="${DEFAULT_GPT_API_KEY}"
fi

export PATH="$HOME/.bun/bin:$PATH"
export OPENCODE_DISABLE_AUTOUPDATE=1
export OPENCODE_DISABLE_CLAUDE_CODE=1
export OPENCODE_DISABLE_EXTERNAL_SKILLS=1

printf '\033]0;%s\007' 'Acompany Secure Code'
cd "${SCRIPT_DIR}"
exec ~/.bun/bin/bun run dev -- "${TARGET_DIR}"
