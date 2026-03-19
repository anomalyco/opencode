#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSET_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUNNERS_DIR="${ASSET_DIR}/runners"
WORKLOAD_DIR="${ASSET_DIR}/workload"

if [ -f "${ASSET_DIR}/.env" ]; then
  # shellcheck disable=SC1091
  source "${ASSET_DIR}/.env"
fi

PARENT_DIR="${1:-}"
CONCURRENCY="${2:-}"
ROUNDS="${3:-0}"

if [ -z "${PARENT_DIR}" ] || [ -z "${CONCURRENCY}" ]; then
  echo "usage: $0 <parent_dir> <concurrency> [rounds]" >&2
  exit 1
fi

mkdir -p "${PARENT_DIR}"

echo "securecode session load runner started"
echo "parent_dir=${PARENT_DIR}"
echo "concurrency=${CONCURRENCY}"
echo "rounds=${ROUNDS}"
echo "started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

round=0
while true; do
  round=$((round + 1))
  run_id="live-$(date -u +%Y%m%d-%H%M%S)-c${CONCURRENCY}-r${round}"
  echo "begin_round=${round} run_id=${run_id} started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  python3 "${RUNNERS_DIR}/securecode_session_capacity.py" \
    --output-dir "${PARENT_DIR}/${run_id}" \
    --workload-file "${WORKLOAD_DIR}/securecode_workload.json" \
    --base-url "${SECURECODE_BASE_URL:-http://localhost:8080/v1}" \
    --model "${SECURECODE_MODEL:-model-under-test}" \
    --api-key "${SECURECODE_API_KEY:-${OPENAI_API_KEY:-}}" \
    --locale "${SECURECODE_LOCALE:-zh-CN}" \
    --concurrency "${CONCURRENCY}" \
    --timeout-s 900 \
    --seed "${SECURECODE_SESSION_SEED:-42}" \
    --remote-host ""
  echo "end_round=${round} run_id=${run_id} ended_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  if [ "${ROUNDS}" -gt 0 ] && [ "${round}" -ge "${ROUNDS}" ]; then
    break
  fi
  sleep 1
done

echo "securecode session load runner finished ended_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
