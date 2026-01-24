# Issue #10342: /compact doesn't utilize prompt caching

## Root Cause Analysis

### Problem Statement

When using the `/compact` command (or automatic compaction), the system does NOT utilize prompt caching, which means:
- Compaction requests are more expensive than necessary
- Longer response times for compaction
- Higher API costs for users
- Wasted bandwidth sending the same system prompts repeatedly

### Technical Details

**Compaction File**: `packages/opencode/src/session/compaction.ts:144-164`

```typescript
const result = await processor.process({
  user: userMessage,
  agent,
  abort: input.abort,
  sessionID: input.sessionID,
  tools: {},
  system: [],  // ❌ BUG: Empty array - no system prompts sent!
  messages: [
    ...MessageV2.toModelMessages(input.messages, model),
    {
      role: "user",
      content: [
        {
          type: "text",
          text: promptText,
        },
      ],
    },
  ],
  model,
})
```

**Normal Request** (for comparison) from `prompt.ts:596-615`:
```typescript
const result = await processor.process({
  user: lastUser,
  agent,
  abort,
  sessionID,
  system: [...(await SystemPrompt.environment()), ...(await SystemPrompt.custom())],
  messages: [
    ...MessageV2.toModelMessages(sessionMessages, model),
    // ... more messages
  ],
  tools,
  model,
})
```

### How Prompt Caching Works

**File**: `packages/opencode/src/provider/transform.ts:164-203`

```typescript
function applyCaching(msgs: ModelMessage[], providerID: string): ModelMessage[] {
  const system = msgs.filter((msg) => msg.role === "system").slice(0, 2)
  const final = msgs.filter((msg) => msg.role !== "system").slice(-2)

  const providerOptions = {
    anthropic: {
      cacheControl: { type: "ephemeral" },
    },
    openrouter: {
      cacheControl: { type: "ephemeral" },
    },
    bedrock: {
      cachePoint: { type: "ephemeral" },
    },
    openaiCompatible: {
      cache_control: { type: "ephemeral" },
    },
  }

  for (const msg of unique([...system, ...final])) {
    // Apply cache control to system messages and last 2 user/assistant messages
    msg.providerOptions = {
      ...msg.providerOptions,
      ...providerOptions,
    }
  }

  return msgs
}
```

**Key Points**:
1. **System messages** (first 2) get cache control applied
2. **Last 2 messages** (user/assistant) get cache control applied
3. Compaction passes `system: []` - so **NO system messages are cached**
4. Cacheable system prompts include:
   - Environment-specific context (project info, rules, etc.)
   - Custom instructions from config

### Why This Matters

**Cost Impact**:
- System prompts can be 2,000+ tokens
- With caching: Cache read tokens cost ~90% less (e.g., $0.30/1M vs $3.00/1M for Claude)
- Without caching: Pay full price every time

**Performance Impact**:
- Cached prompts have faster response times
- Less data transferred over network

**User Experience**:
- Compaction happens frequently (near context limits)
- Each compaction without caching wastes money and time

### Solution

**File**: `packages/opencode/src/session/compaction.ts:150`

**Current Code**:
```typescript
system: [],
```

**Fixed Code**:
```typescript
system: [...(await SystemPrompt.environment()), ...(await SystemPrompt.custom())],
```

This matches the pattern used in normal requests (see `prompt.ts:601`).

### Import Required

Need to add import at top of file if not present:
```typescript
import { SystemPrompt } from "./system"
```

### Complete Fix

**Location**: `packages/opencode/src/session/compaction.ts:144-164`

**Before**:
```typescript
const result = await processor.process({
  user: userMessage,
  agent,
  abort: input.abort,
  sessionID: input.sessionID,
  tools: {},
  system: [],
  messages: [
    ...MessageV2.toModelMessages(input.messages, model),
    {
      role: "user",
      content: [
        {
          type: "text",
          text: promptText,
        },
      ],
    },
  ],
  model,
})
```

**After**:
```typescript
const result = await processor.process({
  user: userMessage,
  agent,
  abort: input.abort,
  sessionID: input.sessionID,
  tools: {},
  system: [...(await SystemPrompt.environment()), ...(await SystemPrompt.custom())],
  messages: [
    ...MessageV2.toModelMessages(input.messages, model),
    {
      role: "user",
      content: [
        {
          type: "text",
          text: promptText,
        },
      ],
    },
  ],
  model,
})
```

### Testing

**Manual Testing**:
1. Start a long conversation that approaches context limits
2. Run `/compact` command
3. Check network request payload in browser DevTools or logs
4. Verify system prompts are included in the request
5. Verify cache control headers are present

**Automated Testing**:
```typescript
test("compaction includes system prompts for caching", async () => {
  await using tmp = await tmpdir({
    config: {
      instructions: "Test custom instruction",
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-session"

      // Create some messages
      await SessionCompaction.create({
        sessionID,
        agent: "build",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-5-20250515" },
        auto: false,
      })

      // Verify system prompts are included in the API call
      // This would require mocking the LLM.stream call
    },
  })
})
```

### Impact

**Severity**: MEDIUM - Cost and performance issue, but functionality works

**Affected Users**:
- All users who trigger compaction (manual `/compact` or automatic)
- Especially impactful for users with large system prompts
- High-volume users will see significant cost savings

**Benefits**:
- Reduced API costs (cached tokens are ~90% cheaper)
- Faster compaction responses
- Consistent behavior between normal requests and compaction

**Before Fix**:
- System prompts sent every time without caching
- Full price paid for system prompts on each compaction

**After Fix**:
- System prompts cached after first compaction
- Subsequent compactions pay ~90% less for cached tokens

### Related Code

**System Prompt Generation**:
- `packages/opencode/src/session/system.ts` - SystemPrompt class
- `packages/opencode/src/session/prompt.ts:601` - Normal usage pattern

**Caching Implementation**:
- `packages/opencode/src/provider/transform.ts:164-203` - applyCaching function

**Compaction**:
- `packages/opencode/src/session/compaction.ts:92-193` - Main compaction process
- `packages/opencode/src/agent/prompt/compaction.txt` - Compaction prompt template

### Status

- ✅ Root cause identified
- ✅ Solution designed
- ⏳ Awaiting write permissions to implement fix
- ⏳ Tests to be written

### Prevention

**Code Review Checklist**:
- [ ] All requests to LLM should include system prompts for consistency
- [ ] System prompts should be included in caching strategy
- [ ] Check for empty `system: []` arrays in LLM calls
- [ ] Verify cost optimization for high-frequency operations

**Pattern**:
Any call to `processor.process()` should include:
```typescript
system: [...(await SystemPrompt.environment()), ...(await SystemPrompt.custom())],
```

Unless there's a specific reason to exclude system prompts.
