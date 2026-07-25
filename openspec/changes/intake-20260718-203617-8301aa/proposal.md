# sub-agent loop detection

## Why

A sub-agent spawned via the Task tool can enter an infinite loop with no fast detection. The current protections address the obvious cases:

1. ✅ Default sub-agent step limit (50 steps)
2. ✅ Per-turn chunk timeout (120s for local providers)
3. ✅ Sub-agent total timeout (10 minutes)
4. ✅ Bigram-based text-only loop detection in the prompt loop (threshold 0.92, max streak 3)

**The remaining gap:** the existing loop detection at `prompt.ts:1415-1455` only triggers when a turn has **no tool calls**. A sub-agent stuck in a tool-call loop — repeatedly calling the same tool with different arguments, or cycling through the same tool set — is invisible to the current mechanism.

`PatternDetection` exists at `packages/opencode/src/pattern-detection/pattern-detection.ts` with a configurable similarity approach and a `toolUsage` parameter, but:
- It is not wired into the prompt loop
- The `toolUsage` parameter is stored in history but never compared
- `AutomationFeatures` (the only public accessor) is disabled by default

## What

Wire PatternDetection into the prompt loop as an **additional** check alongside the existing bigram detection, with tool-usage tracking so that tool-call loops are detected and the sub-agent is aborted early.

### Approach

**Option A (chosen):** Add `PatternDetection.detectPattern()` as an additional check alongside the existing bigram check. This preserves the existing text-only detection and adds tool-usage-aware pattern detection.

- After each assistant message, extract a tool usage string (e.g., "read,bash,read") from the message parts
- Call `PatternDetection.detectPattern(text, toolUsage)` alongside the existing bigram check
- When PatternDetection returns `true`, set `handle.message.error` and break the loop, mirroring existing behavior
- Enable `AutomationFeatures.patternDetection.enabled` by default

**Rejected Option B:** Replace inline bigram code with `AutomationFeatures.detectAndHandleLoop`. This consolidates logic but is a larger refactor that risks regression in the well-tested existing path.

### Implementation details

1. **Extract tool usage string:** From the current message's parts, collect tool names (e.g., `["read","bash","read"]` → `"read,bash,read"`) and pass as `toolUsage` parameter.

2. **Make PatternDetection compare tool usage:** Update `PatternDetection.similarity()` to also compare `toolUsage` strings when both are present, using bigram similarity (matching the approach in `loop.ts`) rather than the current character-level matching.

3. **Wire into prompt loop:** Insert the PatternDetection check after the existing bigram check in `prompt.ts:1415-1455`. It runs regardless of whether there are tool calls (unlike the existing check which requires `!currentHasToolCalls`).

4. **Enable by default:** Set `AutomationFeatures.patternDetection.enabled: true` in the default config.

### Constraints

- Must not regress the existing text-only bigram loop detection — it remains the primary mechanism
- Must not regress the loop engine's own detection in `loop.ts`
- PatternDetection is **additive** — it catches cases the bigram check misses (tool-call loops)
- Changes are limited to wiring in PatternDetection; no redesign of the similarity algorithm

### Non-goals

- Redesigning the loop detection algorithm
- Changing the bigram similarity threshold or logic in the prompt loop or loop engine
- Adding new configuration options beyond enabling what exists
- Consolidating loop detection into AutomationFeatures (that's a future refactor)

## Scope

**Files to modify:**
- `packages/opencode/src/session/prompt.ts` — wire PatternDetection into the prompt loop (lines 1415-1455)
- `packages/opencode/src/pattern-detection/pattern-detection.ts` — make toolUsage parameter functional (compare tool usage strings with bigram similarity)
- `packages/opencode/src/automation/automation-features.ts` — enable patternDetection by default

**Files to create:**
- Tests for tool-call loop detection and regression tests

## Risks

- **False positives:** PatternDetection's similarity on tool usage strings could trigger on legitimate tool sequences. Mitigate by keeping conservative thresholds (same as text detection: 0.92 bigram threshold, max streak 3).
- **Performance:** Adding a PatternDetection call per turn adds overhead. Mitigate by only running when there are tool calls (complementary to the existing text-only check).
- **Regression:** Adding a new check in the prompt loop could affect latency or break existing behavior. Test with existing sub-agent scenarios before deploying.
