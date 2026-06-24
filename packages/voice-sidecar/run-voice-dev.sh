#!/usr/bin/env bash
# Start/stop opencode (from source) + voice sidecar with unified file logging.
#
# Usage:
#   ./run-voice-dev.sh start          # opencode serve + voice-stt converse
#   ./run-voice-dev.sh stop
#   ./run-voice-dev.sh restart
#   ./run-voice-dev.sh status
#   ./run-voice-dev.sh logs           # print log path + last 80 lines
#   ./run-voice-dev.sh logs 200       # last N lines
#   ./run-voice-dev.sh logs-path      # print log file path only
#
# Env:
#   XAI_API_KEY              required — export before running (https://console.x.ai)
#   OPENCODE_PORT            default 4096
#   OPENCODE_WORKSPACE       default repo root (parent of packages/)
#   VOICE_MODE               converse (default) | ask
#   VOICE_ASK_TEXT           text for ask mode (default: "list the files in src")
#   BUN                      path to bun (default: bun on PATH)

set -euo pipefail

SIDECAR_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "${XAI_API_KEY:-}" ]; then
  echo "error: XAI_API_KEY is not set — export it before running this script" >&2
  exit 1
fi

REPO_ROOT="$(cd "$SIDECAR_DIR/../.." && pwd)"
RUN_DIR="$SIDECAR_DIR/.voice-dev"
LOG_FILE="$RUN_DIR/voice-dev.log"
OPENCODE_PID_FILE="$RUN_DIR/opencode.pid"
SIDECAR_PID_FILE="$RUN_DIR/sidecar.pid"

PORT="${OPENCODE_PORT:-4096}"
WORKSPACE="${OPENCODE_WORKSPACE:-$REPO_ROOT}"
MODE="${VOICE_MODE:-converse}"
ASK_TEXT="${VOICE_ASK_TEXT:-list the files in src}"
if [[ -z "${BUN:-}" ]]; then
  if command -v bun >/dev/null 2>&1; then
    BUN=bun
  elif [[ -x "$HOME/.bun/bin/bun" ]]; then
    BUN="$HOME/.bun/bin/bun"
  else
    BUN=bun
  fi
fi
VENV_BIN="$SIDECAR_DIR/.venv/bin"
VOICE_STT="$VENV_BIN/voice-stt"
OPENCODE_ENTRY="$REPO_ROOT/packages/opencode/src/index.ts"
SERVER_URL="http://127.0.0.1:${PORT}"

ts() { date '+%Y-%m-%dT%H:%M:%S'; }

runner_log() {
  mkdir -p "$RUN_DIR"
  printf '[%s] [runner] %s\n' "$(ts)" "$*" | tee -a "$LOG_FILE"
}

pid_alive() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

read_pid() {
  local file="$1"
  [[ -f "$file" ]] || return 1
  tr -d '[:space:]' < "$file"
}

stop_pid_file() {
  local file="$1"
  local label="$2"
  local pid
  pid="$(read_pid "$file" 2>/dev/null)" || return 0
  if pid_alive "$pid"; then
    runner_log "stopping $label (pid $pid)"
    kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      pid_alive "$pid" || break
      sleep 0.25
    done
    if pid_alive "$pid"; then
      runner_log "force-killing $label (pid $pid)"
      kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    fi
  fi
  rm -f "$file"
}

require_bun() {
  if ! command -v "$BUN" >/dev/null 2>&1; then
    runner_log "ERROR: bun not found. Install: curl -fsSL https://bun.sh/install | bash"
    exit 1
  fi
}

require_sidecar() {
  if [[ ! -x "$VOICE_STT" ]]; then
    runner_log "ERROR: $VOICE_STT not found. Run: cd $SIDECAR_DIR && python3 -m venv .venv && pip install -e ."
    exit 1
  fi
  if [[ -z "${XAI_API_KEY:-}" ]]; then
    runner_log "ERROR: XAI_API_KEY is not set"
    exit 1
  fi
}

require_opencode_entry() {
  if [[ ! -f "$OPENCODE_ENTRY" ]]; then
    runner_log "ERROR: opencode entry not found at $OPENCODE_ENTRY"
    exit 1
  fi
}

wait_for_opencode() {
  local url="$SERVER_URL/global/health"
  runner_log "waiting for opencode at $url"
  for _ in $(seq 1 120); do
    if curl -sf "$url" >/dev/null 2>&1; then
      runner_log "opencode is healthy"
      return 0
    fi
    sleep 0.5
  done
  runner_log "ERROR: opencode did not become healthy within 60s"
  return 1
}

launch_bg() {
  local label="$1"
  shift
  mkdir -p "$RUN_DIR"
  if command -v setsid >/dev/null 2>&1; then
    nohup setsid env PYTHONUNBUFFERED=1 OPENCODE_DIRECTORY="$WORKSPACE" "$@" >> "$LOG_FILE" 2>&1 < /dev/null &
  else
    nohup env PYTHONUNBUFFERED=1 OPENCODE_DIRECTORY="$WORKSPACE" "$@" >> "$LOG_FILE" 2>&1 < /dev/null &
  fi
  local pid=$!
  disown -h "$pid" 2>/dev/null || true
  echo "$pid"
}

start_opencode() {
  if pid="$(read_pid "$OPENCODE_PID_FILE" 2>/dev/null)" && pid_alive "$pid"; then
    runner_log "opencode already running (pid $pid)"
    return 0
  fi
  rm -f "$OPENCODE_PID_FILE"
  require_bun
  require_opencode_entry
  runner_log "starting opencode serve port=$PORT workspace=$WORKSPACE"
  pid="$(launch_bg opencode bash -c "cd \"$WORKSPACE\" && exec \"$BUN\" run --conditions=browser \"$OPENCODE_ENTRY\" serve --port \"$PORT\"")"
  echo "$pid" > "$OPENCODE_PID_FILE"
  runner_log "opencode pid $(cat "$OPENCODE_PID_FILE")"
  wait_for_opencode
}

start_sidecar() {
  if pid="$(read_pid "$SIDECAR_PID_FILE" 2>/dev/null)" && pid_alive "$pid"; then
    runner_log "sidecar already running (pid $pid)"
    return 0
  fi
  rm -f "$SIDECAR_PID_FILE"
  require_sidecar
  runner_log "starting voice sidecar mode=$MODE server=$SERVER_URL"
  if [[ "$MODE" == "ask" ]]; then
    pid="$(launch_bg sidecar "$VOICE_STT" ask --server "$SERVER_URL" "$ASK_TEXT")"
  else
    pid="$(launch_bg sidecar "$VOICE_STT" converse --server "$SERVER_URL")"
  fi
  echo "$pid" > "$SIDECAR_PID_FILE"
  runner_log "sidecar pid $(cat "$SIDECAR_PID_FILE")"
}

cmd_start() {
  mkdir -p "$RUN_DIR"
  runner_log "=== start ==="
  runner_log "log file: $LOG_FILE"
  start_opencode
  start_sidecar
  runner_log "=== running ==="
  cmd_status
}

cmd_stop() {
  runner_log "=== stop ==="
  stop_pid_file "$SIDECAR_PID_FILE" "sidecar"
  stop_pid_file "$OPENCODE_PID_FILE" "opencode"
  runner_log "=== stopped ==="
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

cmd_status() {
  local oc_pid sc_pid
  oc_pid="$(read_pid "$OPENCODE_PID_FILE" 2>/dev/null || echo "")"
  sc_pid="$(read_pid "$SIDECAR_PID_FILE" 2>/dev/null || echo "")"
  printf 'log: %s\n' "$LOG_FILE"
  printf 'server: %s\n' "$SERVER_URL"
  printf 'workspace: %s\n' "$WORKSPACE"
  if pid_alive "$oc_pid"; then
    printf 'opencode: running (pid %s)\n' "$oc_pid"
  else
    printf 'opencode: stopped\n'
  fi
  if pid_alive "$sc_pid"; then
    printf 'sidecar: running (pid %s, mode %s)\n' "$sc_pid" "$MODE"
  else
    printf 'sidecar: stopped\n'
  fi
}

cmd_logs() {
  local lines="${1:-80}"
  if [[ ! -f "$LOG_FILE" ]]; then
    echo "log file does not exist yet: $LOG_FILE"
    exit 1
  fi
  echo "$LOG_FILE"
  echo "--- last $lines lines ---"
  tail -n "$lines" "$LOG_FILE"
}

cmd_logs_path() {
  echo "$LOG_FILE"
}

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \?//'
}

main() {
  local cmd="${1:-}"
  shift || true
  case "$cmd" in
    start) cmd_start ;;
    stop) cmd_stop ;;
    restart) cmd_restart ;;
    status) cmd_status ;;
    logs) cmd_logs "${1:-80}" ;;
    logs-path) cmd_logs_path ;;
    -h|--help|help|"") usage ;;
    *)
      echo "unknown command: $cmd" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
