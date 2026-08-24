# Fix /loop false-positive stall detection

## Problem

The `/loop` command stalls too aggressively. A loop with `noProgressLimit: 10` (default) and `NoProgressSimilarityThreshold: 0.92` will stall when:

1. Iterations have tool calls but near-identical output (bigram similarity >= 0.92)
2. Output is genuinely different but the bigram similarity crosses 0.92 due to structural similarity (e.g., long file contents, boilerplate)

The current logic at `packages/opencode/src/loop/loop.ts:548-569`:

```ts
const limit = updated.info.noProgressLimit
const noToolCalls = result.toolCalls === 0
const nearIdentical =
  updated.lastOutput !== undefined &&
  similarity(result.output, updated.lastOutput) >= NoProgressSimilarityThreshold
const streak =
  noToolCalls && (updated.noProgressStreak === 0 || nearIdentical) ? updated.noProgressStreak + 1 : 0
```

This counts a streak only when `noToolCalls` is true AND either first iteration or near-identical output. The problem is:

1. **Tool calls should reset the streak unconditionally** — if the model is making tool calls, it's progressing, regardless of output similarity
2. **The bigram similarity threshold (0.92) is too sensitive** — outputs that differ in small but meaningful ways (e.g., a single word change in a long file) will still score 0.92+

## Root cause

The streak increments only when `noToolCalls` is true. This means tool-call iterations already don't contribute to the stall streak. The real issue is likely:

- The similarity function is too aggressive at declaring outputs "near-identical"
- The default `noProgressLimit: 10` is too low for complex tasks that produce structurally similar output across iterations
- The bigram approach doesn't account for semantic changes in long outputs

## Fix

1. **Calibrate the similarity threshold** — increase `NoProgressSimilarityThreshold` from 0.92 to 0.96 or higher, or switch to a more robust similarity metric
2. **Increase default noProgressLimit** — consider raising the default from 10 to 15 or making it adaptive based on output length
3. **Add a minimum output-change heuristic** — if the output length changes by more than X%, consider it progress even if bigram similarity is high

## Verification

- Add test cases for: loop with tool calls across iterations, loop with structurally similar output, loop with semantic changes in long output
- Ensure existing stall behavior is preserved for truly stalled loops (identical output, no tool calls)
