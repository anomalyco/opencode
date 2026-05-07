#!/bin/bash
# E2E test: run opencode itself against Databricks Model Serving for one
# representative of each major foundation-model class (Claude / GPT / Gemini)
# using the profile in opencode.json. Tests basic response + tool use.

set -u
BASE_URL="http://localhost:4096"
PROVIDER="databricks"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

MODELS=(
  "databricks-claude-sonnet-4-6"
  "databricks-gpt-5-5"
  "databricks-gemini-2-5-pro"
)

PASSED=0
FAILED=0
ERRORS=()
SERVER_PID=""

start_server() {
  echo -n "  Starting dev server... "
  pkill -f "bun.*serve" 2>/dev/null
  sleep 1
  cd "$SCRIPT_DIR" && bun dev serve > /tmp/opencode-test-server.log 2>&1 &
  SERVER_PID=$!
  for i in $(seq 1 30); do
    if curl -s "$BASE_URL/session" | jq -e . > /dev/null 2>&1; then
      echo "OK (pid: $SERVER_PID)"
      return 0
    fi
    sleep 1
  done
  echo "FAIL (timeout)"
  return 1
}

stop_server() {
  pkill -f "bun.*serve" 2>/dev/null
}

test_model() {
  local model="$1"
  echo ""
  echo "============================================"
  echo "Testing: $model"
  echo "============================================"

  echo -n "  Creating session... "
  local sess
  sess=$(curl -s -X POST "$BASE_URL/session" -H "Content-Type: application/json" -d '{"title":"test-'"$model"'"}')
  local sid
  sid=$(echo "$sess" | jq -r '.id // empty')
  if [ -z "$sid" ]; then
    echo "FAIL"
    FAILED=$((FAILED + 1)); ERRORS+=("$model: session creation failed"); return 1
  fi
  echo "$sid"

  echo -n "  Basic response... "
  local resp
  resp=$(curl -s --max-time 120 -X POST "$BASE_URL/session/$sid/message" \
    -H "Content-Type: application/json" \
    -d '{"model":{"providerID":"'"$PROVIDER"'","modelID":"'"$model"'"},"parts":[{"type":"text","text":"What is 2+2? Answer with just the number."}]}')
  local err
  err=$(echo "$resp" | jq -r '.info.error.name // empty')
  if [ -n "$err" ]; then
    local msg
    msg=$(echo "$resp" | jq -r '.info.error.data.message // empty' | head -c 200)
    echo "FAIL ($err: $msg)"
    FAILED=$((FAILED + 1)); ERRORS+=("$model: basic - $err - $msg"); return 1
  fi
  local txt
  txt=$(echo "$resp" | jq -r '[.parts[] | select(.type=="text") | .text] | join(" ")')
  if [ -z "$txt" ] || [ "$txt" = "null" ]; then
    echo "FAIL (no text)"
    FAILED=$((FAILED + 1)); ERRORS+=("$model: no text in basic response"); return 1
  fi
  local in_t out_t
  in_t=$(echo "$resp" | jq '.info.tokens.input // 0')
  out_t=$(echo "$resp" | jq '.info.tokens.output // 0')
  echo "OK (\"${txt:0:50}\") [${in_t}/${out_t} tokens]"

  echo -n "  Tool call... "
  local tool_resp
  tool_resp=$(curl -s --max-time 300 -X POST "$BASE_URL/session/$sid/message" \
    -H "Content-Type: application/json" \
    -d '{"model":{"providerID":"'"$PROVIDER"'","modelID":"'"$model"'"},"parts":[{"type":"text","text":"Use the read tool to read the file at /Users/david.okeeffe/Repos/opencode/opencode.json and tell me the value of provider.databricks.options.profile."}]}')
  local terr
  terr=$(echo "$tool_resp" | jq -r '.info.error.name // empty')
  if [ -n "$terr" ]; then
    local tmsg
    tmsg=$(echo "$tool_resp" | jq -r '.info.error.data.message // empty' | head -c 200)
    echo "FAIL ($terr: $tmsg)"
    FAILED=$((FAILED + 1)); ERRORS+=("$model: tool - $terr - $tmsg"); return 1
  fi
  local hist
  hist=$(curl -s "$BASE_URL/session/$sid/message")
  local n_tools
  n_tools=$(echo "$hist" | jq '[.[] | .parts[] | select(.type=="tool")] | length')
  local final_text
  final_text=$(echo "$tool_resp" | jq -r '[.parts[] | select(.type=="text") | .text] | join(" ")' | head -c 200)
  if [ "$n_tools" -gt 0 ]; then
    local names
    names=$(echo "$hist" | jq -r '[.[] | .parts[] | select(.type=="tool") | .tool] | unique | join(", ")')
    echo "OK (tools: $names) text: \"${final_text:0:80}\""
    PASSED=$((PASSED + 1))
  else
    echo "FAIL (no tool call) text: \"${final_text:0:80}\""
    FAILED=$((FAILED + 1)); ERRORS+=("$model: no tool call in tool test")
  fi
}

echo "====================================================="
echo "  Databricks 3-class opencode E2E"
echo "====================================================="
echo "  Profile: $(jq -r '.provider.databricks.options.profile' opencode.json)"
echo "  Models:  ${#MODELS[@]}"
echo "====================================================="

if ! curl -s "$BASE_URL/session" | jq -e . > /dev/null 2>&1; then
  start_server || exit 1
else
  echo "  Server already running"
fi

for m in "${MODELS[@]}"; do test_model "$m"; done

echo ""
echo "====================================================="
echo "  RESULTS: $PASSED / ${#MODELS[@]} passed"
echo "====================================================="
if [ ${#ERRORS[@]} -gt 0 ]; then
  echo "  Failures:"
  for e in "${ERRORS[@]}"; do echo "    - $e"; done
fi
exit $FAILED
