#!/usr/bin/env bash
# DACMICU Adoption Eval
# Measures whether the LLM chooses bash+oc scripts over individual tool calls
# for tasks that should naturally benefit from scripted approaches.
#
# Usage: ./test/eval/dacmicu-adoption.sh [--dry-run]
#
# Scoring:
#   2 = bash tool used with oc commands (full DACMICU)
#   1 = bash tool used without oc (partial)
#   0 = individual tool calls only (no DACMICU adoption)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RUN_DIR="$RESULTS_DIR/$TIMESTAMP"
DRY_RUN="${1:-}"

mkdir -p "$RUN_DIR"

# --- Eval prompts ---
# Natural task descriptions. NO mention of oc, scripts, bash, MICU, or DAC.
# Each should trigger one of the 3 patterns if the system prompt works.

PROMPTS=(
  # Pattern 1 targets (Ralph Loop — retry/verify)
  "Run the TypeScript type checker and fix any type errors you find. Keep going until it passes clean."

  # Pattern 2 targets (CLI Power — batch operations)
  "Count the lines of code in each .ts file under src/tool/ and show me the top 10 largest files."
  "List every file in src/session/ that imports from '../tool/tool'. Show the filename and the import line for each match."

  # Pattern 3 targets (Fabric — analysis pipelines)
  "Read every file in src/server/routes/ and write a summary of all API endpoints to /tmp/api-endpoints.md"
  "Find all TODO and FIXME comments in src/ and create a prioritized report grouped by category."
)

PATTERN_NAMES=(
  "Ralph Loop (retry/verify)"
  "CLI Power (batch count)"
  "CLI Power (batch search)"
  "Fabric (map-reduce)"
  "Fabric (pipeline)"
)

# --- Scoring function ---
score_run() {
  local json_file="$1"

  if [ ! -f "$json_file" ]; then
    echo "0"
    return
  fi

  # Count bash tool calls that contain 'oc ' in the command
  local bash_with_oc
  bash_with_oc=$(jq -r '
    select(.type == "tool_use")
    | select(.part.tool == "bash")
    | select(.part.state.input.command | test("\\boc\\s+(tool|prompt|todo|agent)"))
  ' "$json_file" 2>/dev/null | jq -s 'length')

  # Count bash tool calls total
  local bash_total
  bash_total=$(jq -r '
    select(.type == "tool_use")
    | select(.part.tool == "bash")
  ' "$json_file" 2>/dev/null | jq -s 'length')

  # Count non-bash tool calls (read, edit, grep, glob, write individually)
  local individual_tools
  individual_tools=$(jq -r '
    select(.type == "tool_use")
    | select(.part.tool != "bash" and .part.tool != "todowrite" and .part.tool != "task")
  ' "$json_file" 2>/dev/null | jq -s 'length')

  if [ "$bash_with_oc" -gt 0 ]; then
    echo "2"  # Full DACMICU
  elif [ "$bash_total" -gt 0 ] && [ "$individual_tools" -le 2 ]; then
    echo "1"  # Bash but no oc
  else
    echo "0"  # Individual tool calls
  fi
}

# --- Analyze a run's JSON for details ---
analyze_run() {
  local json_file="$1"

  if [ ! -f "$json_file" ]; then
    echo "  (no output)"
    return
  fi

  echo "  Tool calls:"
  jq -r '
    select(.type == "tool_use")
    | "    \(.part.tool): \(.part.state.status // "?")"
  ' "$json_file" 2>/dev/null || echo "    (parse error)"

  # Show bash commands if any
  local bash_cmds
  bash_cmds=$(jq -r '
    select(.type == "tool_use")
    | select(.part.tool == "bash")
    | .part.state.input.command
  ' "$json_file" 2>/dev/null)

  if [ -n "$bash_cmds" ]; then
    echo "  Bash commands:"
    echo "$bash_cmds" | head -5 | sed 's/^/    /'
    local total_lines
    total_lines=$(echo "$bash_cmds" | wc -l)
    if [ "$total_lines" -gt 5 ]; then
      echo "    ... ($total_lines total)"
    fi

    # Check for oc usage
    if echo "$bash_cmds" | grep -q '\boc\s\+\(tool\|prompt\|todo\|agent\)'; then
      echo "  oc usage: YES"
    else
      echo "  oc usage: NO"
    fi
  fi
}

# --- Main ---
echo "=== DACMICU Adoption Eval ==="
echo "Run: $TIMESTAMP"
echo "Results: $RUN_DIR"
echo ""

if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "[DRY RUN] Would execute ${#PROMPTS[@]} prompts:"
  for i in "${!PROMPTS[@]}"; do
    echo "  $((i+1)). [${PATTERN_NAMES[$i]}] ${PROMPTS[$i]:0:80}..."
  done
  exit 0
fi

total_score=0
max_score=$((${#PROMPTS[@]} * 2))

for i in "${!PROMPTS[@]}"; do
  prompt="${PROMPTS[$i]}"
  pattern="${PATTERN_NAMES[$i]}"
  n=$((i+1))
  outfile="$RUN_DIR/prompt_${n}.jsonl"

  echo "--- Prompt $n/${#PROMPTS[@]}: $pattern ---"
  echo "  \"${prompt:0:80}...\""
  echo "  Running..."

  # Run opencode with JSON format, capture all events
  # Uses the model configured in opencode.json
  bun run --conditions=browser "$PROJECT_DIR/src/index.ts" run --format json \
    "$prompt" > "$outfile" 2>"$RUN_DIR/prompt_${n}.stderr" || true

  score=$(score_run "$outfile")
  total_score=$((total_score + score))

  case $score in
    2) label="FULL DACMICU" ;;
    1) label="PARTIAL (bash, no oc)" ;;
    0) label="NO ADOPTION (individual tools)" ;;
  esac

  echo "  Score: $score/2 — $label"
  analyze_run "$outfile"
  echo ""
done

# --- Summary ---
echo "=== SUMMARY ==="
echo "Total: $total_score / $max_score"
pct=$((total_score * 100 / max_score))
echo "Adoption rate: ${pct}%"
echo ""

echo "Per-prompt scores:"
for i in "${!PROMPTS[@]}"; do
  outfile="$RUN_DIR/prompt_$((i+1)).jsonl"
  score=$(score_run "$outfile")
  echo "  $((i+1)). [$score/2] ${PATTERN_NAMES[$i]}"
done

# Save summary
cat > "$RUN_DIR/summary.txt" <<SUMMARY
DACMICU Adoption Eval — $TIMESTAMP
Total: $total_score / $max_score (${pct}%)

Per-prompt:
$(for i in "${!PROMPTS[@]}"; do
  outfile="$RUN_DIR/prompt_$((i+1)).jsonl"
  score=$(score_run "$outfile")
  echo "  $((i+1)). [$score/2] ${PATTERN_NAMES[$i]} — ${PROMPTS[$i]:0:60}"
done)
SUMMARY

echo ""
echo "Full results saved to: $RUN_DIR/"
