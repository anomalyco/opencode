#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSET_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${ASSET_DIR}/../.." && pwd)"
if [ -f "${ASSET_DIR}/.env" ]; then
  # shellcheck disable=SC1091
  source "${ASSET_DIR}/.env"
fi

RUN_DIR="${SECURECODE_RUN_STATE_DIR:-${HOME}/.cache/securecode/run}"
mkdir -p "${RUN_DIR}"
PID_FILE="${RUN_DIR}/securecode-session-load.pid"
META_FILE="${RUN_DIR}/securecode-session-load.meta"

COMMAND="${1:-}"
CONCURRENCY="${2:-128}"
ROUNDS="${3:-0}"

usage() {
  echo "usage: $0 <start|stop|status> [concurrency] [rounds]" >&2
  echo "  start [concurrency=128] [rounds=0(infinite)]" >&2
  exit 1
}

is_running() {
  [ -f "${PID_FILE}" ] && kill -0 "$(cat "${PID_FILE}")" >/dev/null 2>&1
}

stop_running() {
  if is_running; then
    kill "$(cat "${PID_FILE}")" >/dev/null 2>&1 || true
    sleep 1
    kill -9 "$(cat "${PID_FILE}")" >/dev/null 2>&1 || true
  fi
  rm -f "${PID_FILE}" "${META_FILE}"
}

start_load() {
  if is_running; then
    echo "securecode session load already running (pid $(cat "${PID_FILE}"))" >&2
    exit 1
  fi

  local stamp log_path parent_dir
  stamp="$(date -u +%Y%m%d-%H%M%S)"
  parent_dir="${SECURECODE_OUTPUT_ROOT:-${REPO_ROOT}/results}/live-securecode-session-load-${stamp}"
  log_path="${parent_dir}/load.log"
  mkdir -p "${parent_dir}"

  nohup "${SCRIPT_DIR}/securecode_session_load_runner.sh" \
    "${parent_dir}" \
    "${CONCURRENCY}" \
    "${ROUNDS}" >"${log_path}" 2>&1 &

  echo $! > "${PID_FILE}"
  cat > "${META_FILE}" <<EOF
parent_dir=${parent_dir}
log_path=${log_path}
concurrency=${CONCURRENCY}
rounds=${ROUNDS}
started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

  echo "started securecode session load"
  echo "pid: $(cat "${PID_FILE}")"
  echo "results: ${parent_dir}"
  echo "log: ${log_path}"
}

status_load() {
  if is_running; then
    echo "running: yes"
    echo "pid: $(cat "${PID_FILE}")"
  else
    echo "running: no"
  fi
  if [ -f "${META_FILE}" ]; then
    cat "${META_FILE}"
  fi
}

case "${COMMAND}" in
  start)
    start_load
    ;;
  stop)
    stop_running
    echo "stopped securecode session load"
    ;;
  status)
    status_load
    ;;
  *)
    usage
    ;;
esac
