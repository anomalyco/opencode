#!/usr/bin/env bash
set -euo pipefail

RUN_DIR="${SECURECODE_MONITOR_STATE_DIR:-${HOME}/.cache/securecode/securecode-monitor}"
PID_DIR="${RUN_DIR}/pids"
ACTIVE_DIR_FILE="${RUN_DIR}/active_dir"
mkdir -p "${RUN_DIR}" "${PID_DIR}"

COMMAND="${1:-}"
OUTPUT_DIR="${2:-}"

usage() {
  echo "usage: $0 <start|stop|status> [output-dir]" >&2
  exit 1
}

kill_if_running() {
  local pid="$1"
  if [ -n "${pid}" ] && kill -0 "${pid}" >/dev/null 2>&1; then
    kill "${pid}" >/dev/null 2>&1 || true
    sleep 1
    kill -9 "${pid}" >/dev/null 2>&1 || true
  fi
}

stop_all() {
  local pid_file
  for pid_file in "${PID_DIR}"/*.pid; do
    [ -e "${pid_file}" ] || continue
    kill_if_running "$(cat "${pid_file}")"
    rm -f "${pid_file}"
  done
  rm -f "${ACTIVE_DIR_FILE}"
}

start_monitor() {
  local dir="$1"
  mkdir -p "${dir}"
  stop_all

  printf 'timestamp,index,name,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,power.draw\n' > "${dir}/gpu_stats.csv"
  nohup bash -lc '
    while true; do
      ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
      while IFS= read -r line; do
        printf "%s,%s\n" "$ts" "$line"
      done < <(nvidia-smi --query-gpu=index,name,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits)
      sleep 1
    done
  ' >> "${dir}/gpu_stats.csv" 2>/dev/null &
  echo $! > "${PID_DIR}/gpu_stats.pid"

  nohup bash -lc "nvidia-smi pmon -s um -d 1 > '${dir}/gpu_pmon.log'" >/dev/null 2>&1 &
  echo $! > "${PID_DIR}/gpu_pmon.pid"

  nohup bash -lc '
    printf "timestamp,load1,load5,load15,mem_used_mb,mem_free_mb,mem_available_mb,root_used_pct\n" > "'"${dir}"'/system_stats.csv"
    while true; do
      ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
      read -r load1 load5 load15 _ < /proc/loadavg
      read -r _ mem_total mem_used mem_free _ mem_available _ < <(free -m | awk "/^Mem:/ {print \$1, \$2, \$3, \$4, \$5, \$6, \$7}")
      root_used=$(df -P / | awk "NR==2 {gsub(/%/, \"\", \$5); print \$5}")
      printf "%s,%s,%s,%s,%s,%s,%s,%s\n" "$ts" "$load1" "$load5" "$load15" "$mem_used" "$mem_free" "$mem_available" "$root_used" >> "'"${dir}"'/system_stats.csv"
      sleep 1
    done
  ' >/dev/null 2>&1 &
  echo $! > "${PID_DIR}/system_stats.pid"

  ps -eo pid,ppid,pcpu,pmem,cmd | grep -E "vllm|python" | grep -v grep > "${dir}/process_snapshot.txt" || true
  nvidia-smi > "${dir}/nvidia_smi_snapshot.txt" || true
  echo "${dir}" > "${ACTIVE_DIR_FILE}"
}

status_monitor() {
  local pid_file pid state active_dir
  active_dir=""
  if [ -f "${ACTIVE_DIR_FILE}" ]; then
    active_dir="$(cat "${ACTIVE_DIR_FILE}")"
  fi

  echo "active_dir=${active_dir:-none}"
  for pid_file in "${PID_DIR}"/*.pid; do
    [ -e "${pid_file}" ] || continue
    pid="$(cat "${pid_file}")"
    if kill -0 "${pid}" >/dev/null 2>&1; then
      state="running"
    else
      state="stopped"
    fi
    echo "$(basename "${pid_file}" .pid)=${state}:${pid}"
  done
}

case "${COMMAND}" in
  start)
    [ -n "${OUTPUT_DIR}" ] || usage
    start_monitor "${OUTPUT_DIR}"
    echo "started monitor: ${OUTPUT_DIR}"
    ;;
  stop)
    stop_all
    echo "stopped monitor"
    ;;
  status)
    status_monitor
    ;;
  *)
    usage
    ;;
esac
