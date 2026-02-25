# Design: Fix Thinking Block Error

**Date:** 2026-02-25
**Status:** Implemented

## Problem
When using Claude models with extended thinking, the API returns `thinking`/`redacted_thinking` blocks. When OpenCode replays these back (on next message or compaction), if they're modified during storage/retrieval, Claude rejects them:
```
messages.3.content.1: `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified
```

Session becomes stuck — even compaction triggers the same error.

## Root Cause (verified via PR #14393)
1. **Bug 1:** `toModelMessages()` strips `providerMetadata` (including Bedrock thinking signatures) when `differentModel` is true — which always happens during compaction due to model ID format mismatch.
2. **Bug 2:** Asymmetric compaction buffer (20K vs 32K) causes compaction to trigger too late for some models.

## Solution: Root Fix + Configurable Strategy

### Root Fix (from PR #14393)
- Always pass `providerMetadata` for reasoning parts and `callProviderMetadata` for tool parts (removed `differentModel` guard)
- Symmetric compaction buffer using `maxOutputTokens()` consistently

### Configurable Thinking Strategy
Three options available in Settings and Context tab:
- **"none" (default):** Original behavior — send thinking blocks as-is. With the root fix, signatures are now preserved correctly.
- **"strip":** Proactively remove thinking from last assistant message before sending. Prevents errors but loses thinking context.
- **"compact":** Preserve thinking but auto-compact on error. First message may fail, then auto-recovers.

### Error Recovery UI
- Chat error card shows "Retry (strip thinking)" and "Retry (compact session)" buttons
- Context tab shows error alert with recovery buttons when thinking error detected

## Files Modified
1. `message-v2.ts` — Root fix: always pass providerMetadata/callProviderMetadata + conditional strip logic
2. `compaction.ts` — Root fix: symmetric buffer calculation
3. `config.ts` — `thinking_strategy: "none" | "strip" | "compact"` config option
4. `prompt.ts` — Reads config, passes stripLastReasoning flag
5. `processor.ts` — Detects thinking errors, auto-compacts with "compact" strategy
6. `session-turn.tsx` — Error card with retry buttons
7. `session-turn.css` — Error button styles
8. `message-timeline.tsx` — Retry handler wiring
9. `settings-general.tsx` — Thinking Strategy dropdown
10. `session-context-tab.tsx` — Always-visible strategy selector + error recovery
