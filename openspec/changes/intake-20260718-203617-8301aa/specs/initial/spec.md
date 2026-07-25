# sub-agent loop detection

## ADDED

### Tool-Usage String Extraction in Prompt Loop

After each assistant message is processed in the prompt loop (`packages/opencode/src/session/prompt.ts`), the system MUST extract a tool usage string from the message parts. The tool usage string is a comma-separated list of tool names from all tool parts in the current message (e.g., `["read","bash","read"]` → `"read,bash,read"`). This string is passed as the `toolUsage` parameter to `PatternDetection.detectPattern()`.

### Tool-Usage-Aware Pattern Detection

When both `toolUsage` parameters are present on two history entries, `PatternDetection.detectPattern()` MUST compare tool usage strings using bigram similarity (Sørensen-Dice coefficient, matching the approach in `loop.ts`). A tool-call loop is detected when the bigram similarity of tool usage strings across consecutive turns is ≥ the configured `similarityThreshold` (default 0.7) for ≥ `maxRepetitions` (default 5) consecutive turns.

### Pattern Detection Integration in Prompt Loop

The prompt loop MUST call `PatternDetection.detectPattern(text, toolUsage)` after each assistant message, alongside the existing bigram text-only check. When PatternDetection returns `true`, the loop MUST:
1. Set `handle.message.error` to a descriptive error indicating tool-usage loop detection
2. Set `handle.message.time.completed = Date.now()`
3. Call `sessions.updateMessage(handle.message)`
4. Publish `Session.Event.Error` event
5. Break the loop

### Pattern Detection Enabled by Default

`AutomationFeatures.patternDetection.enabled` MUST default to `true` in `packages/opencode/src/automation/automation-features.ts`.

## MODIFIED

### Bigram Similarity Reuse in PatternDetection

The `PatternDetection` service's `similarity()` function for tool usage comparison MUST use bigram similarity (Sørensen-Dice coefficient) matching the `similarity()` function in `loop.ts`, rather than the current character-level matching. Text similarity continues to use the existing approach.

### Existing Bigram Detection Unchanged

The existing bigram-based text-only loop detection in the prompt loop MUST remain unchanged and continue to function as before. Pattern detection is additive — it does not replace, modify, or disable the existing mechanism.

## REMOVED

*(none)*
