#!/usr/bin/env bash
# DACMICU Fast Adoption Eval
# Lightweight prompts that resolve quickly — tests whether the LLM
# CHOOSES to use oc scripts, not whether the scripts work correctly.
#
# Usage: ./test/eval/dacmicu-fast.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RUN_DIR="$RESULTS_DIR/fast_$TIMESTAMP"

mkdir -p "$RUN_DIR"

# Simple prompts that should trigger oc but resolve fast (read-only, small scope)
PROMPTS=(
  "Show me the line count of every .ts file in src/tool/ sorted by size."
  "List every file in src/session/ that imports from '../util'. Show filename and the import line."
  "Find all TODO comments in src/ and group them by priority: high, medium, low."
)

PATTERN_NAMES=(
  "Batch (count files)"
  "Batch (search imports)"
  "Pipeline (grep+analyze)"
)

score_run() {
  local json_file="$1"
  [ ! -f "$json_file" ] && { echo "0"; return; }

  local bash_with_oc
  bash_with_oc=$(jq -r 'select(.type == "tool_use") | select(.part.tool == "bash") | select(.part.state.input.command | test("\\boc\\s+(tool|prompt|todo|agent)"))' "$json_file" 2>/dev/null | jq -s 'length')

  local bash_total
  bash_total=$(jq -r 'select(.type == "tool_use") | select(.part.tool == "bash")' "$json_file" 2>/dev/null | jq -s 'length')

  local individual_tools
  individual_tools=$(jq -r 'select(.type == "tool_use") | select(.part.tool != "bash" and .part.tool != "todowrite" and .part.tool != "task")' "$json_file" 2>/dev/null | jq -s 'length')

  if [ "$bash_with_oc" -gt 0 ]; then
    echo "2"
  elif [ "$bash_total" -gt 0 ] && [ "$individual_tools" -le 2 ]; then
    echo "1"
  else
    echo "0"
  fi
}

echo "=== DACMICU Fast Eval ==="
echo "Run: $TIMESTAMP"
echo ""

total_score=0
max_score=$((${#PROMPTS[@]} * 2))

for i in "${!PROMPTS[@]}"; do
  prompt="${PROMPTS[$i]}"
  pattern="${PATTERN_NAMES[$i]}"
  n=$((i+1))
  outfile="$RUN_DIR/prompt_${n}.jsonl"

  echo -n "  $n. [$pattern] "

  bun run --conditions=browser "$PROJECT_DIR/src/index.ts" run --format json \
    "$prompt" > "$outfile" 2>"$RUN_DIR/prompt_${n}.stderr" || true

  score=$(score_run "$outfile")
  total_score=$((total_score + score))

  # Show bash commands if any
  bash_cmd=$(jq -r 'select(.type == "tool_use") | select(.part.tool == "bash") | .part.state.input.command' "$outfile" 2>/dev/null | head -1)
  has_oc=$(echo "$bash_cmd" | grep -c 'oc ' 2>/dev/null || echo "0")

  case $score in
    2) echo "FULL oc ✓  ${bash_cmd:0:80}" ;;
    1) echo "bash only  ${bash_cmd:0:80}" ;;
    0) echo "no oc ✗" ;;
  esac
done

echo ""
echo "Score: $total_score / $max_score ($(( total_score * 100 / max_score ))%)"
echo "Results: $RUN_DIR/"
