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

## Task 01 — Remove a deprecated function
File: `packages/opencode/src/tool/registry.ts` (~360 lines)
Prompt:

In `packages/opencode/src/tool/registry.ts`, remove the `describeTask` function entirely (declaration and all call sites). Do not touch other files.

Expected: ast_query finds the function and all references, ast_edit replaces them with empty text. Baseline needs multiple edit calls.

## Task 02 — Replace a function implementation
File: `packages/opencode/src/ast/parser.ts` (~220 lines)
Prompt:

In `packages/opencode/src/ast/parser.ts`, replace the entire body of `queryFile` with a new implementation that adds an optional `maxResults?: number` parameter and applies `.slice(0, maxResults)` to the return value.

Expected: ast_query finds `queryFile`, ast_edit replaces the entire function. Baseline needs read + edit with full context.

## Task 03 — Move a class to a new file
File: `packages/opencode/src/tool/edit.ts` (~480 lines)
Prompt:

In `packages/opencode/src/tool/edit.ts`, move the `BlockAnchorReplacer` class into a new file `packages/opencode/src/tool/block_anchor.ts` and update imports in the original file.

Expected: ast_query finds the class, ast_edit removes it from edit.ts. Baseline needs to read the entire class and rewrite the file.

## Task 04 — Rename a method across call sites (control negative)
File: `packages/opencode/src/tool/edit.ts`
Prompt:

In `packages/opencode/src/tool/edit.ts`, rename the `replace` method to `applyReplacement` everywhere it appears.

Expected: This is a simple string rename. Both approaches will likely use edit/replaceAll. Use this as a control to measure AST overhead when not beneficial.

## Task 05 — Add a method to a class
File: `packages/opencode/src/tool/edit.ts`
Prompt:

In `packages/opencode/src/tool/edit.ts`, add a `validate()` method to the `BlockAnchorReplacer` class that checks if `startAnchor` and `endAnchor` are non-empty strings.

Expected: ast_query finds the class, ast_edit replaces the entire class with the new version. Baseline needs read + edit on the class body.

## Task 06 — Change an interface shape
File: `packages/opencode/src/ast/parser.ts`
Prompt:

In `packages/opencode/src/ast/parser.ts`, change the `Interface` type: rename `queryFile` to `queryNodes`, change its return type to `Effect.Effect<QueryMatch[], Error | ParseError>`, and add `export class ParseError extends Error {}` before the interface.

Expected: ast_query finds the interface, ast_edit replaces it. The new class can be added with edit. Baseline needs read + multiple edits.

## Task 07 — Inline a helper function
File: `packages/opencode/src/tool/edit.ts`
Prompt:

In `packages/opencode/src/tool/edit.ts`, inline the `normalizeLineEndings` helper at every call site and remove the function declaration.

Expected: ast_query finds the function and all call sites, ast_edit replaces all 4 nodes. Baseline needs grep + multiple edits.

## Task 08 — Wrap a function body in try/catch
File: `packages/opencode/src/ast/parser.ts`
Prompt:

Wrap the entire body of `loadGrammar` in `packages/opencode/src/ast/parser.ts` in a try/catch that rethrows as `new Error("Failed to load grammar for ${language}: ${e instanceof Error ? e.message : String(e)}")`.

Expected: ast_query finds `loadGrammar`, ast_edit replaces the entire function. Baseline needs read + edit.

## Task 09 — Add logging to all tool execute functions
Files: `packages/opencode/src/tool/ast_edit.ts` + `ast_query.ts`
Prompt:

In both `ast_edit.ts` and `ast_query.ts`, add `console.time(params.filePath)` at the start of the execute function body and `console.timeEnd(params.filePath)` just before each return statement.

Expected: Multi-file, multi-node replacement. ast_query + ast_edit on both files. Most demanding task.

## Task 10 — Remove an entire exported module
File: `packages/opencode/src/tool/registry.ts`
Prompt:

Remove the `LspTool` export and all its references from `packages/opencode/src/tool/registry.ts`. Also remove the import of `LspTool` and any conditional that references it.

Expected: ast_query finds the import, declaration, and all call sites. ast_edit removes all nodes. Baseline needs grep + multiple edits.

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
