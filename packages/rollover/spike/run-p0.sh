#!/usr/bin/env bash
# P0 spike driver (spec Part A §2.2).
# Usage: spike/run-p0.sh <sandboxRoot> <case> [args...]
# Cases: boot, tools, mutate-delete-first, mutate-replace-last-text,
#        background, usage, command, model-limit
set -euo pipefail

SANDBOX="$1"
CASE="$2"
shift 2

PKG_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORK_ROOT="$(cd "$PKG_ROOT/../.." && pwd)"
BIN="$FORK_ROOT/packages/cli/dist/rollover-test/cli-darwin-arm64/bin/opencode"

SPIKE_ROOT="${SPIKE_ROOT:-$SANDBOX/spike}"
mkdir -p "$SPIKE_ROOT" "$SANDBOX/project/.opencode/plugin"
export SPIKE_LOG="$SPIKE_ROOT/log.jsonl"
export SPIKE_FIXTURES="$SPIKE_ROOT/fixtures"
export SPIKE_MUTATE="${SPIKE_MUTATE:-}"
mkdir -p "$SPIKE_FIXTURES"

cp "$PKG_ROOT/spike/plugin.ts" "$SANDBOX/project/.opencode/plugin/rollover-spike.ts"

export HOME="$SANDBOX/home"
export XDG_CONFIG_HOME="$SANDBOX/config"
export XDG_DATA_HOME="$SANDBOX/data"
export XDG_CACHE_HOME="$SANDBOX/cache"
export XDG_STATE_HOME="$SANDBOX/state"
export OPENCODE_CONFIG_DIR="$SANDBOX/config/opencode"
mkdir -p "$OPENCODE_CONFIG_DIR" "$SANDBOX/home"

# Credential scrubbing (spec Part B §1.3): never let a real provider key reach
# the isolated runtime. Every model call goes to the mock provider only.
while IFS='=' read -r name _; do
  case "$name" in
    *[A-Z_]*KEY*|*[A-Z_]*TOKEN*|*[A-Z_]*SECRET*) unset "$name" ;;
  esac
done < <(env | grep -E '^[A-Z_][A-Z0-9_]*=')
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN OPENAI_API_KEY OPENROUTER_API_KEY 2>/dev/null || true

MODEL="mockllm/test-model"

MOCK_URL="${MOCK_URL:-http://127.0.0.1:4545/v1}"

cat > "$OPENCODE_CONFIG_DIR/opencode.json" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "provider": {
    "mockllm": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "MockLLM",
      "options": { "baseURL": "$MOCK_URL" },
      "models": {
        "test-model": { "name": "Test Model", "limit": { "context": 100000, "output": 4000 } }
      }
    }
  },
  "model": "mockllm/test-model",
  "small_model": "mockllm/test-model",
  "autoupdate": false
}
EOF

run() {
  (cd "$SANDBOX/project" && "$BIN" run -m "$MODEL" "$@")
}

case "$CASE" in
  boot)      run "${@:-say hello}" ;;
  tools)     run "${@:-Read the file ./sample.txt using your read tool, then say what you saw.}" ;;
  mutate-*)  run "What is the first line of ./sample.txt? Use your read tool." ;;
  background) run "Start a shell command 'sleep 3 && echo done' in the background, then tell me it started." ;;
  usage)     run "Say the word ping." ;;
  command)
    (cd "$SANDBOX/project" && SPIKE_MODEL="mockllm/test-model" "$BIN" serve --port 4551 > "$SANDBOX/serve.log" 2>&1 &)
    for i in $(seq 1 30); do grep -q "server listening" "$SANDBOX/serve.log" 2>/dev/null && break; sleep 0.5; done
    PW=$(grep "server password" "$SANDBOX/serve.log" | awk '{print $3}')
    AUTH=(-u "opencode:$PW")
    SID=$(curl -s "${AUTH[@]}" -H "content-type: application/json" -X POST http://127.0.0.1:4551/api/session -d '{}' | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['id'])")
    echo "session: $SID"
    curl -s "${AUTH[@]}" -H "content-type: application/json" -X POST "http://127.0.0.1:4551/api/session/$SID/command" -d '{"name":"p0","text":""}' -o /dev/null -w "command http: %{http_code}\n"
    sleep 1
    lsof -ti :4551 | xargs kill 2>/dev/null
    ;;
  model-limit) run "Just say ok." ;;
  *) echo "unknown case: $CASE" >&2; exit 2 ;;
esac
