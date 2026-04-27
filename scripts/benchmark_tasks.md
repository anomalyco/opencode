# Benchmark Task Suite — AST tools vs baseline

10 tasks designed to stress-test large TypeScript files.
Each task is run twice: once with AST tools enabled, once disabled.

## Environment setup

```bash
# Enable tracing
export OPENCODE_TOOL_TRACE=1

# Optional: set task ID before each prompt
export OPENCODE_BENCHMARK_TASK=01
```

## Task 01 — Rename a function across one file
File: `packages/opencode/src/tool/registry.ts` (~300 lines)
Prompt:

Rename the function `describeTask` to `buildTaskDescription` everywhere it appears in `packages/opencode/src/tool/registry.ts`. Do not touch other files.

Expected: 1 edit, no file rewrite needed — ast_edit should target only the declaration node and the two call sites.

## Task 02 — Add a parameter to an existing function
File: `packages/opencode/src/ast/parser.ts` (~220 lines)
Prompt:

In `packages/opencode/src/ast/parser.ts`, add an optional parameter `maxResults?: number` to the `queryFile` function signature and apply a `.slice(0, maxResults)` to the return value before returning.

Expected: surgical edit on 2 nodes (signature + return).

## Task 03 — Add a new export to a large index file
File: `packages/opencode/src/tool/registry.ts`
Prompt:

Add `export { AstQueryTool } from "./ast_query"` and `export { AstEditTool } from "./ast_edit"` at the end of `packages/opencode/src/tool/registry.ts`.

Expected: append-only — ast_edit or patch_file should touch 0 existing lines.

## Task 04 — Fix a bug in a deeply nested function
File: `packages/opencode/src/tool/edit.ts` (~480 lines)
Prompt:

In `packages/opencode/src/tool/edit.ts`, inside the `BlockAnchorReplacer` generator, change the comment `// Only match the first occurrence of the last line` to `// Match first occurrence of last line anchor (greedy=false)`.

Expected: 1-line edit inside a 480-line file — baseline sends full file, ast_edit sends only the ~10-line containing block.

## Task 05 — Extract a constant from a function body
File: `packages/opencode/src/tool/edit.ts`
Prompt:

In `packages/opencode/src/tool/edit.ts`, extract the two similarity threshold constants `SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.0` and `MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.3` into a new exported `const SIMILARITY_THRESHOLDS` object at the top of the file.

Expected: 3 coordinated edits (add const, remove 2 inline declarations).

## Task 06 — Add JSDoc to a specific function
File: `packages/opencode/src/ast/parser.ts`
Prompt:

Add a JSDoc comment to the `detectLanguage` exported function in `packages/opencode/src/ast/parser.ts` explaining that it returns null for unsupported extensions.

Expected: insert-only before the function node — ast_edit targets exact position.

## Task 07 — Change return type of an interface method
File: `packages/opencode/src/ast/parser.ts`
Prompt:

In the `Interface` type in `packages/opencode/src/ast/parser.ts`, change the return type of `queryFile` from `Effect.Effect<QueryMatch[], Error>` to `Effect.Effect<QueryMatch[], Error | ParseError>`.
Also add `export class ParseError extends Error {}` before the `Interface`.

Expected: 2 edits (new class + interface method return type).

## Task 08 — Refactor: inline a one-line helper
File: `packages/opencode/src/tool/edit.ts`
Prompt:

In `packages/opencode/src/tool/edit.ts`, the `normalizeLineEndings` helper is a one-liner. Inline every call site and remove the function declaration.

Expected: finds all 3 call sites + declaration via ast_query, then 4 edits.

## Task 09 — Add error handling to an async function
File: `packages/opencode/src/ast/parser.ts`
Prompt:

Wrap the body of `loadGrammar` in `packages/opencode/src/ast/parser.ts` in a try/catch that rethrows as `new Error("Failed to load grammar for ${language}: ${e instanceof Error ? e.message : String(e)}")`.

Expected: edit wraps exactly the function body — 1 node replacement.

## Task 10 — Large-scale: add logging to every tool execute()
File: `packages/opencode/src/tool/ast_edit.ts` + `ast_query.ts`
Prompt:

In both `ast_edit.ts` and `ast_query.ts`, add a `console.time(params.filePath)` at the start of the execute function body and `console.timeEnd(params.filePath)` just before each return statement.

Expected: multi-file, multi-node edit — most demanding task for both approaches.

## How to run

### Baseline (AST tools disabled)

```bash
export OPENCODE_TOOL_TRACE=1
export OPENCODE_SESSION_LABEL=baseline
export OPENCODE_DISABLE_AST=1
bun dev .
# For each task 01-10, set OPENCODE_BENCHMARK_TASK=<id> and paste the prompt
```

### AST tools enabled

```bash
export OPENCODE_TOOL_TRACE=1
export OPENCODE_SESSION_LABEL=ast
unset OPENCODE_DISABLE_AST
bun dev .
# Repeat the same 10 tasks
```

## Analysis

```bash
bun run scripts/benchmark_report.ts

# With CSV export:
bun run scripts/benchmark_report.ts --csv ~/Desktop/results.csv
```
