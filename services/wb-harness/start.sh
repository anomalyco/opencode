#!/usr/bin/env bash
# Starts wb-harness with valid credentials, verifies a real completion, and stays in the foreground.
#
#   ./start.sh                 # auto: reuse valid credentials, otherwise extract from the browser
#   PORT=3005 ./start.sh       # fixed port
#   WB_BROWSER=chrome ./start.sh
#   ./start.sh --no-restart    # never restart the browser to open the debugging port
#
# Ctrl-C stops the server.

set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-3001}"
BROWSER="${WB_BROWSER:-helium}"
CREDS="${WB_CREDS_FILE:-$HOME/.config/wb-harness/credentials.json}"
RESTART_BROWSER=1
LOG="$(mktemp -t wb-harness)"

for arg in "$@"; do
  case "$arg" in
    --no-restart) RESTART_BROWSER=0 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1;36m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

command -v bun >/dev/null || die "bun is not installed: https://bun.sh"
command -v curl >/dev/null || die "curl is required"

if [ ! -d node_modules ] && [ ! -d ../../node_modules ]; then
  say "installing dependencies"
  bun install >/dev/null
fi

cdp_open() { curl -sf --max-time 2 "http://127.0.0.1:${WB_CDP_PORT:-9333}/json/version" >/dev/null 2>&1; }

extract_credentials() {
  if cdp_open; then
    say "reading credentials from the running $BROWSER session"
    bun run scripts/wb-creds.ts --browser "$BROWSER" --check
    return
  fi

  if [ "$RESTART_BROWSER" -ne 1 ]; then
    die "no credentials and the debugging port is closed. Rerun without --no-restart, or run: bun run creds -- --launch --check --restore"
  fi

  warn "$BROWSER will restart once to expose the DevTools port, then restart again normally"
  say "extracting credentials from $BROWSER"
  bun run scripts/wb-creds.ts --browser "$BROWSER" --launch --check --restore
}

pick_port() {
  local candidate="$1"
  for _ in $(seq 1 20); do
    if ! nc -z 127.0.0.1 "$candidate" >/dev/null 2>&1; then
      printf '%s' "$candidate"
      return
    fi
    candidate=$((candidate + 1))
  done
  die "no free port near $1"
}

smoke() {
  local body
  body=$(printf '{"model":"wb-agent","messages":[{"role":"user","content":"привет"}]}')
  curl -sS --max-time 90 -o "$LOG.smoke" -w '%{http_code}' \
    -H 'content-type: application/json' -d "$body" \
    "http://127.0.0.1:${PORT}/v1/chat/completions" || printf '000'
}

wait_healthy() {
  for _ in $(seq 1 60); do
    if curl -sf --max-time 1 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

start_server() {
  PORT="$PORT" bun run src/index.ts >"$LOG" 2>&1 &
  SERVER_PID=$!
  if ! wait_healthy; then
    tail -20 "$LOG" >&2
    kill "$SERVER_PID" 2>/dev/null || true
    die "harness did not become healthy on port $PORT"
  fi
}

stop_server() {
  kill "${SERVER_PID:-0}" 2>/dev/null || true
  wait "${SERVER_PID:-0}" 2>/dev/null || true
}

trap 'stop_server; rm -f "$LOG" "$LOG.smoke"; exit 130' INT TERM

# A previous run on the same port would hide the smoke result; stop it first.
if curl -sf --max-time 1 "http://127.0.0.1:${PORT}/health" 2>/dev/null | grep -q wb-harness; then
  say "stopping the previous wb-harness on port $PORT"
  pkill -f "$(pwd)/src/index.ts" 2>/dev/null || true
  pkill -f "bun run src/index.ts" 2>/dev/null || true
  sleep 1
fi

PORT=$(pick_port "$PORT")

state=$(bun -e '
  const { readCredentials, tokenExpiry } = await import("./src/credentials.ts")
  const credentials = readCredentials()
  if (!credentials) { console.log("missing"); process.exit(0) }
  const expires = credentials.expiresAt ?? tokenExpiry(credentials.token)
  if (expires && new Date(expires) < new Date()) { console.log("expired"); process.exit(0) }
  console.log("ok")
' 2>/dev/null || echo missing)

if [ "$state" != "ok" ]; then
  say "credentials: $state"
  extract_credentials
else
  say "credentials: $CREDS"
fi

say "starting harness on http://127.0.0.1:${PORT}"
start_server

status=$(smoke)
if [ "$status" = "401" ]; then
  warn "credentials were rejected, refreshing from $BROWSER"
  stop_server
  extract_credentials
  start_server
  status=$(smoke)
fi

if [ "$status" = "429" ]; then
  warn "upstream rate limit is active: $(head -c 300 "$LOG.smoke")"
  warn "the server stays up; retry in a few minutes"
elif [ "$status" != "200" ]; then
  warn "smoke completion failed with HTTP $status"
  head -c 400 "$LOG.smoke" >&2 || true
  echo >&2
else
  say "smoke completion: ok"
fi

cat <<EOF

  chat      POST http://127.0.0.1:${PORT}/v1/chat/completions
  wb proxy  POST http://127.0.0.1:${PORT}/api/chat/v5/message
  health    GET  http://127.0.0.1:${PORT}/health
  opencode  model wildberries/wb-agent (services/wb-harness/opencode.json)

  logs: $LOG
  Ctrl-C stops the server.
EOF

wait "$SERVER_PID"
