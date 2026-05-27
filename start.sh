#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ENV="$SCRIPT_DIR/packages/opencode-patent-plugin/.env"

# Export all variables from .env (skip comments and empty lines)
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
  value="${value%%#*}"
  value="$(echo "$value" | xargs)"
  # Skip if already set in environment (e.g. DEEPSEEK_API_KEY)
  if [ -n "${!key:-}" ]; then
    export "$key=${!key}"
  else
    export "$key=$value"
  fi
done < "$PLUGIN_ENV"

# LLM_API_KEY fallback: use DEEPSEEK_API_KEY from shell environment
if [ -z "${LLM_API_KEY:-}" ] && [ -n "${DEEPSEEK_API_KEY:-}" ]; then
  export LLM_API_KEY="$DEEPSEEK_API_KEY"
fi

# Ensure YUNPAT_PATH
export YUNPAT_PATH="${YUNPAT_PATH:-/Users/xujian/projects/YunPat}"

echo "[YunPat OpenCode]"
echo "  DB:     ${PATENT_DB_HOST:-localhost}:${PATENT_DB_PORT:-5432}/${PATENT_DB_DATABASE:-patent_db}"
echo "  LLM:    ${LLM_MODEL:-deepseek-chat} @ ${LLM_BASE_URL:-https://api.deepseek.com/v1}"
echo "  YunPat: $YUNPAT_PATH"
echo ""

cd "$SCRIPT_DIR/packages/opencode"
exec bun run --conditions=browser ./src/index.ts "$@"
