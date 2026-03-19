#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSET_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${ASSET_DIR}/../.." && pwd)"
RUNNERS_DIR="${ASSET_DIR}/runners"
WORKLOAD_DIR="${ASSET_DIR}/workload"

if [ -f "${ASSET_DIR}/.env" ]; then
  # shellcheck disable=SC1091
  source "${ASSET_DIR}/.env"
fi

RUN_ID="${1:-securecode-session-capacity-$(date -u +%Y%m%d-%H%M%S)}"
shift || true

RESULTS_ROOT="${SECURECODE_OUTPUT_ROOT:-${REPO_ROOT}/results}"
RESULTS_DIR="${RESULTS_ROOT}/${RUN_ID}"

python3 "${RUNNERS_DIR}/securecode_session_capacity.py" \
  --output-dir "${RESULTS_DIR}" \
  --workload-file "${WORKLOAD_DIR}/securecode_workload.json" \
  --base-url "${SECURECODE_BASE_URL:-http://localhost:8080/v1}" \
  --model "${SECURECODE_MODEL:-model-under-test}" \
  --api-key "${SECURECODE_API_KEY:-${OPENAI_API_KEY:-}}" \
  --locale "${SECURECODE_LOCALE:-zh-CN}" \
  --remote-host "${SECURECODE_REMOTE_HOST:-}" \
  --remote-ncc-dir "${SECURECODE_REMOTE_MONITOR_DIR:-}" \
  --remote-run-root "${SECURECODE_REMOTE_RUN_ROOT:-~/.cache/securecode/securecode-monitor/runs}" \
  --backing-model "${SECURECODE_BACKING_MODEL:-unspecified}" \
  --seed "${SECURECODE_SESSION_SEED:-42}" \
  "$@"

if python3 "${RUNNERS_DIR}/render_securecode_session_charts.py" "${RESULTS_DIR}" >/dev/null 2>&1; then
  echo "charts: ${RESULTS_DIR}/charts"
else
  echo "warning: session chart rendering skipped. Install benchmark extras if you need PNG outputs." >&2
fi

echo "results: ${RESULTS_DIR}"
