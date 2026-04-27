#!/usr/bin/env bash
set -euo pipefail

# Benchmark runner for AST tools vs baseline
# Runs dev source code headlessly via `bun run src/index.ts run`

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TASKS=(
  "Rename the function describeTask to buildTaskDescription everywhere it appears in packages/opencode/src/tool/registry.ts. Do not touch other files."
  "In packages/opencode/src/ast/parser.ts, add an optional parameter maxResults?: number to the queryFile function signature and apply a .slice(0, maxResults) to the return value before returning."
  "Add export { AstQueryTool } from \"./ast_query\" and export { AstEditTool } from \"./ast_edit\" at the end of packages/opencode/src/tool/registry.ts."
  "In packages/opencode/src/tool/edit.ts, inside the BlockAnchorReplacer generator, change the comment // Only match the first occurrence of the last line to // Match first occurrence of last line anchor (greedy=false)."
  "In packages/opencode/src/tool/edit.ts, extract the two similarity threshold constants SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.0 and MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.3 into a new exported const SIMILARITY_THRESHOLDS object at the top of the file."
  "Add a JSDoc comment to the detectLanguage exported function in packages/opencode/src/ast/parser.ts explaining that it returns null for unsupported extensions."
  "In the Interface type in packages/opencode/src/ast/parser.ts, change the return type of queryFile from Effect.Effect<QueryMatch[], Error> to Effect.Effect<QueryMatch[], Error | ParseError>. Also add export class ParseError extends Error {} before the Interface."
  "In packages/opencode/src/tool/edit.ts, the normalizeLineEndings helper is a one-liner. Inline every call site and remove the function declaration."
  "Wrap the body of loadGrammar in packages/opencode/src/ast/parser.ts in a try/catch that rethrows as new Error(\"Failed to load grammar for \${language}: \${e instanceof Error ? e.message : String(e)}\")."
  "In both packages/opencode/src/tool/ast_edit.ts and packages/opencode/src/tool/ast_query.ts, add a console.time(params.filePath) at the start of the execute function body and console.timeEnd(params.filePath) just before each return statement."
  "In packages/opencode/src/tool/edit.ts, change these 4 comments: 1) // Only match the first occurrence of the last line → // Match first occurrence of last line anchor, 2) // Try to find a unique anchor → // Find a unique anchor for this block, 3) // If the block wasn't found, try again with the last line only → // Fallback: search with last line only, 4) // If we get here, we couldn't find the block → // Block not found after all attempts."
  "In packages/opencode/src/tool/registry.ts, add console.log('Entering', tool.id) at the start of the execute functions for all, ids, and tools. Do not change other functions."
  "In packages/opencode/src/ast/parser.ts, rename these variables: grammarMap → grammarCache, parserMap → parserCache, queryCache → patternCache, fileLanguageMap → fileLanguageCache, supportedLanguages → supportedLanguageList."
)

run_suite() {
  local mode="$1"
  echo "=== Running suite: $mode ==="

  if [ "$mode" = "baseline" ]; then
    export OPENCODE_DISABLE_AST=1
  else
    unset OPENCODE_DISABLE_AST
  fi

  for i in "${!TASKS[@]}"; do
    local num=$((i + 1))
    local task_id
    printf -v task_id "%02d" "$num"
    echo "--- Task $task_id ($mode) ---"

    # Reset files before each task
    git checkout -- packages/opencode/src/ 2>/dev/null || true

    export OPENCODE_TOOL_TRACE=1
    export OPENCODE_SESSION_LABEL="${mode}_task${task_id}"
    export OPENCODE_BENCHMARK_TASK="${task_id}"

    # Run headless from dev source. --dangerously-skip-permissions auto-approves edits.
    bun run --cwd packages/opencode --conditions=browser src/index.ts run "${TASKS[$i]}" --dangerously-skip-permissions

    echo "Task $task_id ($mode) complete."
    echo ""
  done
}

# Main
rm -f tool_trace.jsonl
run_suite "baseline"
run_suite "ast"

echo "=== Benchmark complete. Generating report... ==="
bun run scripts/benchmark_report.ts --csv benchmark_results.csv
