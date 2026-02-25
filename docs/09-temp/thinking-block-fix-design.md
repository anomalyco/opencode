# Design: Fix Thinking Block Error (Option D)

**Date:** 2026-02-25
**Status:** Approved — Ready to implement

## Problem
When using Claude models with extended thinking, the API returns `thinking`/`redacted_thinking` blocks. When OpenCode replays these back (on next message or compaction), if they're modified during storage/retrieval, Claude rejects them:
```
messages.3.content.1: `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified
```

Session becomes stuck — even compaction triggers the same error.

## Root Cause
`MessageV2.toModelMessages()` stores reasoning parts as `{type: "reasoning", text: part.text}` but the original API response had `{type: "thinking", thinking: "..."}`. The reconstruction is not byte-identical. Claude's constraint only applies to the LAST assistant message.

## Approach: Strip reasoning from last assistant message (user-controlled)

### Component 1: Backend Strip Logic
**File:** `packages/opencode/src/session/message-v2.ts`

In `toModelMessages()`, add optional `stripLastReasoning` parameter:
```typescript
export function toModelMessages(input: WithParts[], model: Provider.Model, opts?: { stripLastReasoning?: boolean }): ModelMessage[] {
  // ... existing code ...
  
  // Before return, if stripLastReasoning:
  if (opts?.stripLastReasoning) {
    const lastAssistantIdx = result.findLastIndex((msg) => msg.role === "assistant")
    if (lastAssistantIdx !== -1) {
      result[lastAssistantIdx].parts = result[lastAssistantIdx].parts.filter((p) => p.type !== "reasoning")
      if (result[lastAssistantIdx].parts.length === 0 || result[lastAssistantIdx].parts.every((p) => p.type === "step-start")) {
        result.splice(lastAssistantIdx, 1)
      }
    }
  }
  
  return convertToModelMessages(...)
}
```

### Component 2: Config Setting
**File:** `packages/opencode/src/config/config.ts`

Add to appearance/compaction config:
```typescript
strip_thinking_on_error: z.boolean().optional().default(false).describe("Automatically strip thinking blocks when API error occurs")
```

### Component 3: Auto-Retry in Processor
**File:** `packages/opencode/src/session/processor.ts`

In the catch block (~line 350), detect the specific error:
```typescript
const isThinkingError = e?.message?.includes("thinking") && e?.message?.includes("cannot be modified")
if (isThinkingError) {
  const config = await Config.get()
  if (config.strip_thinking_on_error) {
    // Auto-retry with stripped thinking
    // Set a flag that toModelMessages should strip
    continue // retry the loop
  }
  // Otherwise, throw the error (UI will show "Retry without thinking" button)
}
```

### Component 4: Error Card Button
**File:** `packages/ui/src/components/message-part.tsx`

In the error rendering section (~line 1040), detect thinking error:
```tsx
<Match when={cleaned.includes("thinking") && cleaned.includes("cannot be modified")}>
  <Card variant="error">
    <div>{cleaned}</div>
    <Button onClick={() => retryWithoutThinking()} variant="secondary">
      Retry without thinking blocks
    </Button>
  </Card>
</Match>
```

### Component 5: Settings Toggle
**File:** `packages/app/src/components/settings-general.tsx`

Add toggle in Appearance section:
```
Strip Thinking on Error: [Toggle]
Description: "Automatically retry without thinking blocks when API rejects modified thinking content"
```

## Implementation Order
1. Backend strip logic (message-v2.ts)
2. Config setting (config.ts)
3. Auto-retry logic (processor.ts)
4. Error card button (message-part.tsx)
5. Settings toggle (settings-general.tsx)

## Testing
- Reproduce with Claude Opus in long conversation
- Verify error → button appears
- Click button → retries successfully
- Enable auto-mode → errors auto-recover
- Compaction still works after fix
