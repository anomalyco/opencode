# Research: sub-agent loop detection

## Summary

The intake proposes four protections to prevent sub-agents from entering infinite loops. However, the current codebase (opencode-skein) has already implemented three of the four fixes since the proposal was written:

1. **DefaultSubAgentSteps is already 50** — set at `packages/opencode/src/session/prompt.ts:79`, applied at line 1249.
2. **SUBAGENT_TASK_TIMEOUT_MS is already 10 minutes** — set at `packages/opencode/src/tool/task.ts:36` (was 20min, now 10min).
3. **Loop detection is already wired into the prompt loop** — lines 1415–1455 of `prompt.ts` run bigram similarity (threshold 0.92) on consecutive assistant output; after 3 consecutive near-identical turns with no tool calls, the loop breaks.
4. **chunkTimeout has a default** — `LOCAL_PROVIDER_CHUNK_TIMEOUT_DEFAULT = 120_000` in `packages/opencode/src/provider/provider.ts:64`.

The **remaining gap** is that the `PatternDetection` service (at `packages/opencode/src/pattern-detection/pattern-detection.ts`) exists with `enabled: true` by default, but is **not wired into the main prompt loop**. Its `detectAndHandleLoop` method lives in `AutomationFeatures` (at `packages/opencode/src/automation/automation-features.ts:62`) but that entire service is disabled by default.

## Affected Files / Modules

- **`packages/opencode/src/session/prompt.ts`** (lines 1415–1455): Loop detection already wired — uses bigram similarity from `loop.ts`, threshold 0.92, max streak 3. This is the primary loop breaker for sub-agents.
- **`packages/opencode/src/pattern-detection/pattern-detection.ts`**: Character-level similarity service, enabled by default. Not wired into the prompt loop — only accessible via `AutomationFeatures`.
- **`packages/opencode/src/automation/automation-features.ts`**: Aggregates PatternDetection + AutoReply + Scheduler. `detectAndHandleLoop` available but `enabled: false` and `patternDetection.enabled: false` in defaults.
- **`packages/opencode/src/tool/task.ts`**: Sub-agent timeout already 10 minutes (line 36).
- **`packages/opencode/src/provider/provider.ts`**: `chunkTimeout` default 120s for local providers (line 64).
- **`packages/opencode/src/loop/loop.ts`**: Bigram similarity function (`similarity`, line 115), used by the prompt loop's loop detection.

## Prior Art

- **Loop engine** (`packages/opencode/src/loop/loop.ts`): Dedicated loop service with its own iteration loop, no-progress detection using Sørensen-Dice bigram similarity (threshold 0.92), and per-iteration timing. This is the authoritative loop detection used by the CLI `loop` command.
- **Prompt loop detection** (`prompt.ts:1415–1455): Reuses the same `similarity` function from `loop.ts` (imported at line 64). Tracks `lastOutputText` and `loopStreak` per session.
- **PatternDetection service** (`pattern-detection.ts`): A separate, simpler character-level similarity (not bigrams). Uses a sliding time window with configurable threshold. Not used in production paths.
- **AutomationFeatures** (`automation-features.ts`): Higher-level aggregation layer that could unify pattern detection, auto-reply, and scheduler. Disabled by default.

## Risks and Unknowns

- **PatternDetection's similarity function is weaker**: It uses character-level matching (iterating over characters of the shorter string), not bigrams. This means it may produce false positives on short repetitive text like "Thinking..." that don't actually indicate a loop.
- **The prompt loop's loop detection only catches text-only loops**: It checks `!currentHasToolCalls` and only compares text output. If a sub-agent is stuck in a tool-call loop (e.g., repeatedly calling the same tool with different args), the similarity check on text won't catch it. PatternDetection's `toolUsage` parameter could help here, but it's unused.
- **What additional detection is needed**: The existing prompt-loop loop detection (lines 1415–1455) already handles the most common case (text loops). PatternDetection could add value for tool-usage patterns, but the tool-usage tracking is not wired in.
- **AutomationFeatures enabled state**: If we wire PatternDetection into the prompt loop, should AutomationFeatures be enabled by default? It currently has `enabled: false` and all sub-features disabled.

## Recommendation

**The immediate intake concerns are already addressed** in the current codebase. The four fixes described in the proposal have been implemented:

1. ✅ Default sub-agent step limit (50) — done
2. ✅ Per-turn chunk timeout (120s) — done
3. ✅ Sub-agent total timeout (10 min) — done
4. ✅ Loop detection in prompt loop — done (bigram-based, threshold 0.92)

**If additional work is desired beyond the intake:**
- Wire PatternDetection's `detectPattern` into the prompt loop as an *additional* layer, specifically for catching tool-usage pattern repetition (not just text similarity). This would require updating the existing loop detection code at `prompt.ts:1415–1455` to also query `AutomationFeatures.detectAndHandleLoop`.
- Alternatively, enable `AutomationFeatures` by default and let it own loop detection entirely, replacing the inline code in `prompt.ts` with a single call to `AutomationFeatures.detectAndHandleLoop`.
- Consider whether PatternDetection's character-level similarity should be replaced with the bigram approach from `loop.ts` for consistency.

**The intake itself is superseded** — the architect can proceed directly to planning without implementing these four points.
