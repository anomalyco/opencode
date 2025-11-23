# Trajectory Recording FAQ - Important Findings

This document addresses specific questions about how OpenCode handles LLM interactions, reasoning, and session management that impact trajectory recording implementation.

---

## Question 1: How are reasoning chains/text handled across providers?

### Answer: Provider-dependent via AI SDK abstraction

**Finding from codebase analysis:**

OpenCode uses the Vercel AI SDK which provides **standardized reasoning events** regardless of provider:

- `reasoning-start` - Reasoning block begins
- `reasoning-delta` - Incremental reasoning text
- `reasoning-end` - Reasoning block completes

**Code location**: `/packages/opencode/src/session/processor.ts:56-95`

```typescript
case "reasoning-start":
  reasoningMap[value.id] = {
    type: "reasoning",
    text: "",
    time: { start: Date.now() },
    metadata: value.providerMetadata,
  }
  break

case "reasoning-delta":
  const part = reasoningMap[value.id]
  part.text += value.text
  await Session.updatePart({ part, delta: value.text })
  break

case "reasoning-end":
  const part = reasoningMap[value.id]
  part.time = { ...part.time, end: Date.now() }
  await Session.updatePart(part)
  break
```

### Provider-specific behavior:

| Provider/Model | Reasoning Behavior | Captured as | Config in OpenCode |
|----------------|-------------------|-------------|-------------------|
| **Anthropic (Claude)** | Extended thinking via `reasoning` parameter | `reasoning-delta` events → `ReasoningPart` | Auto-enabled |
| **OpenAI (o1/o3)** | ❌ Hidden reasoning (not exposed in API) | No reasoning events (token count only) | N/A |
| **OpenAI (o1 via responses API)** | ❌ May expose reasoning tokens in usage | Only token count visible, not text | N/A |
| **OpenAI (GPT-OSS 120B)** | ✅ **Exposed reasoning tokens** | `reasoning-delta` events → `ReasoningPart` | Via AI SDK provider |
| **Google (Gemini-3)** | ✅ Thoughts via `thinkingConfig` | `reasoning-delta` events → `ReasoningPart` | `includeThoughts: true` (transform.ts:146) |
| **GPT-5 models** | ✅ Reasoning via `reasoningEffort` | `reasoning-delta` events → `ReasoningPart` | `reasoningEffort: medium` (transform.ts:157) |
| **DeepSeek R1** | ⚠️ Reasoning in response text with `<think>` tags | Treated as regular `text-delta` (not separate) | None |
| **Other providers** | Varies - SDK attempts to normalize | Depends on provider SDK implementation | Varies |

### Key Insight: Generic Reasoning Capture

**OpenCode's reasoning handling is provider-agnostic** (see `processor.ts:56-95`). It listens for `reasoning-start`, `reasoning-delta`, and `reasoning-end` events from the Vercel AI SDK.

**This means:**
- ✅ **GPT-OSS 120B** (and similar models) that expose reasoning via the AI SDK will automatically be captured
- ✅ Any new provider that emits reasoning events will work without code changes
- ❌ Models that don't emit reasoning events (o1/o3) won't have reasoning text captured

### Implications for trajectory recording:

1. **Reasoning is always captured when available** via `ReasoningPart` in message storage
2. **DeepSeek-style reasoning** (in response text) shows up as regular text, NOT separate reasoning
3. **OpenAI o1/o3** reasoning is **hidden** - you only get token counts, not content
4. **GPT-OSS 120B and similar** will be captured the same way as Claude's extended thinking
5. **Trajectory events should record**:
   - Both `text` and `reasoning` parts separately
   - Provider metadata (`value.providerMetadata`) which may contain provider-specific info
   - Whether reasoning was used (via model config: `model.info.reasoning`)
   - Model ID to differentiate hidden vs exposed reasoning

### Example trajectory events:

**When reasoning IS exposed (Claude, GPT-OSS 120B, Gemini-3, GPT-5):**
```jsonl
{"type":"stream_event","eventType":"reasoning-start","data":{"id":"reasoning_1"}}
{"type":"stream_event","eventType":"reasoning-delta","data":{"id":"reasoning_1","reasoning":"Let me think through this step by step..."}}
{"type":"stream_event","eventType":"reasoning-end","data":{"id":"reasoning_1"}}
{"type":"llm_interaction","response":{"reasoningLength":1234,"reasoningTokens":450,"hasHiddenReasoning":false}}
```
*Note: Full reasoning text is captured and stored as `ReasoningPart`*

**Specifically for GPT-OSS 120B:**
```jsonl
{"type":"llm_interaction","model":{"provider":"openai","id":"gpt-oss-120b"},"response":{"textLength":500,"reasoningLength":2000,"reasoningTokens":800,"hasHiddenReasoning":false}}
```
*Note: Both reasoning text AND token counts are available*

**When reasoning is hidden (OpenAI o1/o3):**
```jsonl
{"type":"llm_interaction","model":{"provider":"openai","id":"o1"},"response":{"textLength":500,"reasoningLength":0,"reasoningTokens":5000,"hasHiddenReasoning":true}}
```
*Note: No reasoning text, but token count shows reasoning happened*

**When reasoning is in text (DeepSeek R1):**
```jsonl
{"type":"stream_event","eventType":"text-delta","data":{"text":"<think>Let me analyze...</think>"}}
{"type":"llm_interaction","model":{"provider":"deepseek","id":"deepseek-r1"},"response":{"textLength":2345,"reasoningLength":0,"reasoningTokens":0,"hasHiddenReasoning":false}}
```
*Note: Reasoning appears as text, not separate reasoning events*

---

## Question 1b: Does OpenCode support OpenAI Harmony format?

### Answer: YES! It's the default for OpenAI and Azure providers ✅

**Found in:** `provider.ts:58-95`

OpenCode uses the **OpenAI Responses API** (which implements Harmony format) as the default for OpenAI providers.

### Code Evidence:

```typescript
// OpenAI provider (line 58-65)
openai: async () => {
  return {
    autoload: false,
    async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
      return sdk.responses(modelID)  // ← Uses Responses API (Harmony)
    },
  }
}

// Azure provider (line 67-78)
azure: async () => {
  return {
    async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
      if (options?.["useCompletionUrls"]) {
        return sdk.chat(modelID)      // ← Legacy Chat API
      } else {
        return sdk.responses(modelID) // ← Default: Responses API (Harmony)
      }
    },
  }
}
```

### What this means:

| Provider | Default API | Format | Override Option |
|----------|-------------|--------|-----------------|
| **OpenAI** | `sdk.responses()` | Harmony | None (always Harmony) |
| **Azure** | `sdk.responses()` | Harmony | `useCompletionUrls: true` → Chat API |
| **Azure Cognitive Services** | `sdk.responses()` | Harmony | `useCompletionUrls: true` → Chat API |

### Implications for Trajectory Recording:

1. **Harmony format is used by default** for OpenAI/Azure providers
2. **Reasoning tokens** from models like GPT-OSS 120B are already supported via Harmony
3. **Message format** follows Harmony spec (handled by Vercel AI SDK)
4. **No special trajectory handling needed** - the AI SDK normalizes everything

### What is Harmony Format?

Harmony is OpenAI's newer unified API format (via the Responses API) that:
- Supports streaming and non-streaming in one API
- Better handles reasoning tokens for models like o1/o3/GPT-OSS
- Provides more structured responses
- Is the foundation for future OpenAI features

**OpenCode already uses it!** 🎉

---

## Question 2: Are responses always streamed?

### Answer: No! Both `streamText()` and `generateText()` are used

**Finding from codebase analysis:**

OpenCode uses **TWO different LLM call patterns**:

### 1. `streamText()` - Used for main agent loop
**Location**: `/packages/opencode/src/session/prompt.ts:508-598`

```typescript
const result = await processor.process(() =>
  streamText({
    model: model.language,
    messages: [...],
    tools: tools,
    // ... returns async event stream
  })
)
```

**Characteristics:**
- Returns async event stream
- Processed by `SessionProcessor`
- Emits events: start, text-delta, reasoning-delta, tool-call, tool-result, step-finish, finish
- **This is what we primarily record in trajectories**

### 2. `generateText()` - Used for non-interactive operations
**Locations found**:

#### a) Title generation (`/packages/opencode/src/session/summary.ts:86-108`)
```typescript
const result = await generateText({
  maxOutputTokens: small.info.reasoning ? 1500 : 20,
  messages: [
    { role: "system", content: "Generate a concise title..." },
    { role: "user", content: textPart.text }
  ],
  model: small.language,
})
userMsg.summary.title = result.text
```

#### b) Summary generation (`/packages/opencode/src/session/summary.ts:131-150`)
```typescript
const result = await generateText({
  model: small.language,
  maxOutputTokens: 100,
  messages: [...conversation, { role: "user", content: "Summarize..." }],
})
summary = result.text
```

#### c) Compaction (`/packages/opencode/src/session/compaction.ts:132-200`)
```typescript
// Actually uses streamText, not generateText!
const result = await processor.process(() =>
  streamText({
    messages: [...pastMessages, { role: "user", content: "Provide a detailed summary..." }],
    tools: {}, // No tools during compaction
  })
)
```

**Characteristics:**
- Returns complete response (no streaming)
- **No events emitted** - just final result
- Used for background operations (titles, summaries)
- **NOT currently recorded** in the main agent loop

### Implications for trajectory recording:

#### Option A: Record only main agent loop (streamText)
**Pros:**
- Simpler implementation
- Most important interactions
- Lower overhead

**Cons:**
- Missing title/summary generation
- Incomplete view of all LLM calls
- Harder to debug summary issues

#### Option B: Record ALL LLM calls (both streamText and generateText)
**Pros:**
- Complete trajectory
- Better for debugging
- Full token accounting

**Cons:**
- More complexity
- Need to hook multiple locations
- More data to store

### Recommended approach:

**Record both, but mark them differently:**

```jsonl
// Main agent loop
{"type":"llm_interaction","interactionType":"stream","purpose":"agent_step","sessionID":"ses_123",...}

// Title generation
{"type":"llm_interaction","interactionType":"generate","purpose":"title","sessionID":"ses_123",...}

// Summary generation
{"type":"llm_interaction","interactionType":"generate","purpose":"summary","sessionID":"ses_123",...}

// Compaction
{"type":"llm_interaction","interactionType":"stream","purpose":"compaction","sessionID":"ses_123",...}
```

### Injection points needed:

1. **Main loop**: Already planned in `prompt.ts:508`
2. **Title generation**: Add to `summary.ts:86` (before generateText)
3. **Summary generation**: Add to `summary.ts:131` (before generateText)
4. **Compaction**: Add to `compaction.ts:132` (before streamText)

---

## Question 3: What happens during compaction? Do we get a new session?

### Answer: NO new session - compaction adds a summary message within the SAME session

**Finding from codebase analysis:**

### How compaction works:

**Location**: `/packages/opencode/src/session/compaction.ts`

#### 1. **Trigger**: Context window overflow
```typescript
export function isOverflow(input: { tokens, model }) {
  const context = input.model.limit.context
  const count = input.tokens.input + input.tokens.cache.read + input.tokens.output
  const usable = context - output
  return count > usable  // Returns true when over limit
}
```

#### 2. **Process**: Create summary message in SAME session
```typescript
export async function process(input) {
  // Creates a NEW MESSAGE (not a new session!)
  const msg = await Session.updateMessage({
    id: Identifier.ascending("message"),
    role: "assistant",
    parentID: input.parentID,  // Links to parent message
    sessionID: input.sessionID, // SAME SESSION ID
    summary: true,              // Marked as summary message
    // ...
  })

  // Calls LLM to generate summary
  const result = await processor.process(() =>
    streamText({
      messages: [
        ...input.messages,  // Include all previous messages
        { role: "user", content: "Provide a detailed but concise summary..." }
      ],
    })
  )
}
```

#### 3. **Result**: Session continues with summary message inserted

**Message flow**:
```
Session: ses_abc123
├─ msg_001 [user]: "Help me build a web app"
├─ msg_002 [assistant]: "I'll help you..."
├─ msg_003 [user]: "Add authentication"
├─ msg_004 [assistant]: "Let me add auth..."
├─ ... (many more messages)
├─ msg_050 [user]: [COMPACTION MARKER]
├─ msg_051 [assistant, summary=true]: "Summary: We're building a web app with auth, using React and Node.js..."
└─ msg_052 [user]: "Now add the database"  ← Session continues!
```

### What gets compacted?

**Two mechanisms:**

#### A. Pruning (Tool Output Removal)
**Location**: `compaction.ts:48-86`

```typescript
export async function prune(input: { sessionID: string }) {
  // Goes backwards through messages
  // Finds old tool calls (beyond PRUNE_PROTECT = 40,000 tokens)
  // Marks tool output as compacted
  for (const part of toPrune) {
    part.state.time.compacted = Date.now()  // Marks as compacted
    await Session.updatePart(part)
  }
}
```

**Effect**: Old tool outputs are marked but NOT deleted. They're excluded from future context.

#### B. Summary Message Creation
**Location**: `compaction.ts:88-227`

Creates a summary message that can be used instead of full history.

### Implications for trajectory recording:

#### 1. **Session continuity is maintained**
- Session ID never changes
- All messages stay in the same session
- Trajectory file continues for the same session

#### 2. **Need to record compaction events**
```jsonl
{"type":"agent_step","action":"compaction_check","decision":{"type":"compact","reason":"context_overflow"}}
{"type":"compaction_start","sessionID":"ses_123","messageCount":50,"tokenCount":125000}
{"type":"llm_interaction","purpose":"compaction","messages":[...],"response":{...}}
{"type":"compaction_end","sessionID":"ses_123","summaryMessageID":"msg_051","prunedToolCount":15}
{"type":"agent_step","action":"loop_start","state":{"messageCount":52}}
```

#### 3. **Tool output visibility**
- Compacted tool outputs are still in storage
- They have `part.state.time.compacted = <timestamp>`
- Trajectory should note which tools were compacted

#### 4. **Message history changes**
After compaction, `MessageV2.toModelMessage()` returns:
- System prompts
- Summary message (if exists)
- Recent messages (last N)
- NOT the full original history

**This means**: Trajectory must record the ACTUAL messages sent to LLM, which may differ from full session history.

---

## Updated Implementation Recommendations

Based on these findings, here are the key updates needed:

### 1. Add `interactionType` and `purpose` fields to LLM interactions

```typescript
{
  type: "llm_interaction"
  interactionType: "stream" | "generate"
  purpose: "agent_step" | "title" | "summary" | "compaction"
  // ... rest of fields
}
```

### 2. Record compaction events

```typescript
{
  type: "compaction"
  action: "start" | "prune" | "summarize" | "end"
  // ... compaction details
}
```

### 3. Capture reasoning properly

```typescript
{
  type: "llm_interaction"
  response: {
    textLength: number
    reasoningLength: number      // 0 if no reasoning exposed
    reasoningTokens: number      // May be > 0 even if length is 0 (o1)
    hasHiddenReasoning: boolean  // True for o1/o3
  }
}
```

### 4. Hook additional LLM call sites

- `summary.ts:86` - Title generation
- `summary.ts:131` - Summary generation
- `compaction.ts:132` - Compaction summary
- `prompt.ts:508` - Main agent loop (already planned)

### 5. Record actual messages sent (post-compaction)

Don't just record the full session history - record what actually gets sent to the LLM after filtering/compaction.

---

## Summary Table

| Aspect | Finding | Impact on Trajectory |
|--------|---------|---------------------|
| **Reasoning** | Provider-dependent, abstracted by AI SDK | Record both text and reasoning separately; note when reasoning is hidden |
| **Reasoning Models** | ✅ Claude, GPT-OSS 120B, Gemini-3, GPT-5 expose reasoning<br>❌ o1/o3 hide reasoning (token count only)<br>⚠️ DeepSeek includes in text | Automatically captured for exposed models; track model ID to differentiate |
| **Reasoning in History** | ✅ Reasoning IS sent back in subsequent requests (message-v2.ts:656-662) | Reasoning contributes to input tokens on follow-up turns; track in both directions |
| **Harmony Format** | ✅ OpenAI/Azure use Responses API (Harmony) by default (provider.ts:62) | Already supported; no special handling needed |
| **Streaming** | Both streamText() and generateText() used | Need to hook 4 locations, not just 1 |
| **Compaction** | Same session, adds summary message | Record compaction as special event type; track message filtering |
| **Session continuity** | Never breaks, always same session ID | Single trajectory file per session, even with compaction |
| **Tool pruning** | Marked not deleted, excluded from context | Note compacted tools in trajectory |

---

## Next Steps

1. Update `types.ts` to include:
   - `interactionType` and `purpose` fields
   - `CompactionEvent` type
   - `reasoningTokens` and `hasHiddenReasoning` fields

2. Update `recorder.ts` to handle:
   - Both streamText and generateText calls
   - Compaction events
   - Multiple LLM call sites

3. Update injection points to include:
   - All 4 LLM call locations
   - Compaction start/end
   - Tool pruning events

4. Test with:
   - Different providers (Anthropic, OpenAI, DeepSeek)
   - Sessions that trigger compaction
   - Models with/without reasoning

---

## Code Examples

### Recording generateText calls:

```typescript
// In summary.ts:86
if (TrajectoryRecorder.isRecording(sessionID)) {
  const startTime = Date.now()
  TrajectoryRecorder.record(sessionID, {
    type: "llm_interaction",
    interactionType: "generate",
    purpose: "title",
    startTime,
    input: { messages: [...] },
  })
}

const result = await generateText({...})

if (TrajectoryRecorder.isRecording(sessionID)) {
  TrajectoryRecorder.record(sessionID, {
    type: "llm_interaction",
    interactionType: "generate",
    purpose: "title",
    endTime: Date.now(),
    response: {
      text: result.text,
      usage: result.usage,
    },
  })
}
```

### Recording compaction:

```typescript
// In compaction.ts before process()
if (TrajectoryRecorder.isRecording(sessionID)) {
  TrajectoryRecorder.record(sessionID, {
    type: "compaction",
    action: "start",
    messageCount: input.messages.length,
    tokenCount: calculateTokens(input.messages),
  })
}

const result = await process({...})

if (TrajectoryRecorder.isRecording(sessionID)) {
  TrajectoryRecorder.record(sessionID, {
    type: "compaction",
    action: "end",
    summaryMessageID: msg.id,
    prunedToolCount: prunedTools.length,
  })
}
```
