#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RUN_ID="${1:-securecode-capacity-heavy-$(date -u +%Y%m%d-%H%M%S)}"
if [ "$#" -gt 0 ]; then
  shift
fi

"${SCRIPT_DIR}/run_securecode_capacity.sh" \
  "${RUN_ID}" \
  --concurrency "${SECURECODE_HEAVY_CONCURRENCY:-64,96,128,160,192,256,320,384}" \
  --cycles "${SECURECODE_HEAVY_CYCLES:-96}" \
  --max-tokens "${SECURECODE_HEAVY_MAX_TOKENS:-384}" \
  --interactive-p95-s "${SECURECODE_HEAVY_INTERACTIVE_P95_S:-45}" \
  --batch-p95-s "${SECURECODE_HEAVY_BATCH_P95_S:-120}" \
  "$@"
