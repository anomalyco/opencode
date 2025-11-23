# OpenCode Codebase Architecture - Detailed Analysis for Trajectory Recording

## Overview
OpenCode is a Claude-based agent framework written in TypeScript/Bun. The architecture follows an agent execution loop pattern where:
1. User sends a prompt (message)
2. System calls LLM with conversation history
3. LLM responds with text and/or tool calls
4. Tools execute and return results
5. Loop continues until LLM signals completion

---

## 1. LLM CLIENT ARCHITECTURE

### Key Files
- **Main LLM Call**: `/Users/michael/opencode/packages/opencode/src/session/prompt.ts` (lines 508-598)
- **Provider Configuration**: `/Users/michael/opencode/packages/opencode/src/provider/provider.ts`
- **Model Retrieval**: `/Users/michael/opencode/packages/opencode/src/provider/provider.ts` (functions: `getModel`, `getSDK`)

### LLM API Call Flow

#### 1.1 The streamText Call
**File**: `/Users/michael/opencode/packages/opencode/src/session/prompt.ts` (lines 508-598)
**Function**: `loop()` → `processor.process()`

```typescript
const result = await processor.process(() =>
  streamText({
    // Configuration
    temperature: params.temperature,
    topP: params.topP,
    maxOutputTokens: ProviderTransform.maxOutputTokens(...),
    abortSignal: abort,
    
    // Model & Provider
    model: wrapLanguageModel({
      model: model.language,  // LanguageModel from provider SDK
      middleware: [...]
    }),
    
    // Messages for LLM
    messages: [
      ...system.map(x => ({ role: "system", content: x })),
      ...MessageV2.toModelMessage(msgs),  // Filtered & converted message history
    ],
    
    // Tools available to LLM
    tools: model.info.tool_call === false ? undefined : tools,
    
    // Headers & Options
    headers: {
      ...(model.providerID === "opencode" ? {
        "x-opencode-session": sessionID,
        "x-opencode-request": lastUser.id,
      } : undefined),
      ...model.info.headers,
    },
    
    // Provider-specific options
    providerOptions: ProviderTransform.providerOptions(...),
  })
)
```

#### 1.2 Model Loading - Where API Calls Happen
**File**: `/Users/michael/opencode/packages/opencode/src/provider/provider.ts`

**Key Function: `getModel(providerID: string, modelID: string)`** (lines 590-650)
- Resolves the actual provider SDK (Anthropic, OpenAI, etc.)
- Returns a `LanguageModel` object with `.language` property
- The `language` property contains the actual model instance that makes API calls

**Provider SDK Initialization: `getSDK(provider, model)`** (lines 517-584)
- Dynamically loads provider npm packages (e.g., `@ai-sdk/anthropic`, `@ai-sdk/openai`)
- Uses `BunProc.install()` to fetch/install npm packages
- Applies custom options per provider (API keys, headers, baseURL)
- Returns SDK instance used to create the `languageModel()`

**Custom Loaders** (lines 27-237):
- CUSTOM_LOADERS for providers like:
  - `anthropic`: Sets beta headers for Claude features
  - `openai`: Uses `sdk.responses(modelID)`
  - `azure`: Different URL handling
  - `amazon-bedrock`: AWS credential setup
  - `google-vertex`: GCP project/location setup
  - Multiple other providers

### 1.3 What Parameters Are Passed

**System Messages**: 
- Built by `resolveSystemPrompt()` (lines 621-641)
- Sources: SystemPrompt.header(), agent.prompt, SystemPrompt.provider(), SystemPrompt.environment()

**User Messages & History**:
- Converted by `MessageV2.toModelMessage()` (lines 551-668)
- Includes filtering of certain error messages
- Converts internal Part types to UIMessage format
- Only includes non-ignored text and non-plain-text files

**Tool Definitions**:
- Built by `resolveTools()` (lines 643-757+)
- Each tool wrapped with: `tool({ id, description, inputSchema, execute() })`
- Tools are only active if `model.info.tool_call !== false`

**Configuration Parameters**:
- `temperature`: From agent config or ProviderTransform defaults
- `topP`: From agent config or ProviderTransform defaults
- `maxOutputTokens`: Transformed per provider, capped at OUTPUT_TOKEN_MAX (32,000)
- Provider-specific options from model.info.options + agent.options

### 1.4 What Responses Are Returned

The `streamText()` function returns a `StreamTextResult` that yields events:

**Stream Event Types** (handled in SessionProcessor):
- `start`: Stream begins
- `reasoning-start/delta/end`: Extended thinking/reasoning
- `text-start/delta/end`: Output text
- `tool-input-start/delta/end`: Tool parameter construction
- `tool-call`: Complete tool invocation
- `tool-result`: Tool execution result
- `tool-error`: Tool execution error
- `step-start/finish`: Step boundaries and token/cost tracking
- `finish`: Stream completion

Each event processed in `/Users/michael/opencode/packages/opencode/src/session/processor.ts` (lines 41-380)

### 1.5 Multiple LLM Call Points

**Primary**: `streamText()` in SessionPrompt.loop()
- Line 508-598 in prompt.ts
- Called once per agent step

**Secondary**: `generateText()` calls exist in:
1. **Summary generation**: `/Users/michael/opencode/packages/opencode/src/session/summary.ts`
   - Generates session summaries using a separate LLM call
   
2. **Compaction**: `/Users/michael/opencode/packages/opencode/src/session/compaction.ts`
   - Summarizes old messages when context overflows
   
3. **Agent generation**: `/Users/michael/opencode/packages/opencode/src/agent/agent.ts` (lines 196-217)
   - Creates new agent configurations based on user description

4. **Title generation**: `ensureTitle()` in prompt.ts
   - Generates session titles

**Total Primary Call Sites**: 4+ locations making LLM calls

---

## 2. TOOL EXECUTION

### 2.1 Tool Definition & Registration

**Base Tool Interface**: `/Users/michael/opencode/packages/opencode/src/tool/tool.ts`

```typescript
interface Tool.Info {
  id: string
  init: () => Promise<{
    description: string
    parameters: z.ZodType
    execute(args: Parameters, ctx: Context): Promise<{
      title: string
      metadata: any
      output: string
      attachments?: FilePart[]
    }>
    formatValidationError?(error): string
  }>
}

interface Tool.Context {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
  callID?: string
  metadata(input: { title?, metadata? }): void
}
```

**Tool Registry**: `/Users/michael/opencode/packages/opencode/src/tool/registry.ts`

- Built-in tools (lines 87-103):
  - InvalidTool, BashTool, ReadTool, GlobTool, GrepTool, ListTool
  - EditTool, WriteTool, TaskTool, WebFetchTool
  - TodoWriteTool, TodoReadTool
  - BatchTool (experimental), WebSearchTool, CodeSearchTool (experimental)

- Custom tools loaded from:
  - Config directories: `tool/*.{js,ts}` files
  - Plugin system: `plugin.tool` property

- Tool enable/disable logic (lines 121-140):
  - Permissions checked based on agent config
  - Permission types: edit, bash, webfetch

**Tool List**: 20+ built-in tools located in:
- `/Users/michael/opencode/packages/opencode/src/tool/bash.ts`
- `/Users/michael/opencode/packages/opencode/src/tool/read.ts`
- `/Users/michael/opencode/packages/opencode/src/tool/write.ts`
- `/Users/michael/opencode/packages/opencode/src/tool/edit.ts`
- `/Users/michael/opencode/packages/opencode/src/tool/glob.ts`
- `/Users/michael/opencode/packages/opencode/src/tool/grep.ts`
- `/Users/michael/opencode/packages/opencode/src/tool/ls.ts`
- `/Users/michael/opencode/packages/opencode/src/tool/webfetch.ts`
- `/Users/michael/opencode/packages/opencode/src/tool/websearch.ts`
- `/Users/michael/opencode/packages/opencode/src/tool/task.ts` (subtask execution)
- etc.

### 2.2 Tool Call Processing

**File**: `/Users/michael/opencode/packages/opencode/src/session/processor.ts`

**Tool Call to Result Flow** (lines 97-227):

1. **tool-input-start** (line 97):
   - Creates a new ToolPart with status="pending"

2. **tool-call** (lines 120-178):
   - LLM has finalized tool call
   - Part status updated to "running"
   - Input parameters extracted from LLM
   - Doom loop detection (same tool called 3x with identical args)

3. **tool-result** (lines 180-201):
   - Tool execution succeeded
   - Part status updated to "completed"
   - Output captured and stored
   - Result metadata recorded

4. **tool-error** (lines 204-226):
   - Tool execution failed
   - Part status updated to "error"
   - Error message stored
   - Permission.RejectedError sets blocked=true

**Tool Invocation in SessionPrompt.resolveTools()** (lines 643-757):

Each tool wrapped with execution wrapper (lines 666-725):
```typescript
tools[item.id] = tool({
  id: item.id,
  description: item.description,
  inputSchema: jsonSchema(schema),
  async execute(args, options) {
    // 1. Pre-execution plugin hook
    await Plugin.trigger("tool.execute.before", ...)
    
    // 2. Execute actual tool
    const result = await item.execute(args, {
      sessionID: input.sessionID,
      abort: options.abortSignal,
      messageID: input.processor.message.id,
      callID: options.toolCallId,
      extra: input.model,
      agent: input.agent.name,
      
      // Update tool metadata during execution
      metadata: async (val) => {
        await Session.updatePart({
          ...match,
          state: { ...match.state, title, metadata },
        })
      },
    })
    
    // 3. Post-execution plugin hook
    await Plugin.trigger("tool.execute.after", ...)
    
    return result
  },
  
  // Convert result to model format
  toModelOutput(result) {
    return { type: "text", value: result.output }
  }
})
```

### 2.3 Tool Result Storage

**File**: `/Users/michael/opencode/packages/opencode/src/session/index.ts`

Tool results stored as Parts with structure:
```typescript
MessageV2.ToolPart = {
  type: "tool"
  callID: string
  tool: string
  state: ToolState (pending | running | completed | error)
}

// Completed state includes:
{
  status: "completed"
  input: Record<string, any>
  output: string
  title: string
  metadata: Record<string, any>
  time: { start: number, end: number }
  attachments?: FilePart[]
}
```

### 2.4 How Tool Calls Flow Through System

1. **LLM generates tool call** → `streamText()` yields `tool-call` event
2. **SessionProcessor captures** → Creates/updates ToolPart with call details
3. **AI SDK executes tool** → Calls `tool({ ... execute() })`
4. **Tool execution** → Calls `item.execute(args, ctx)` with sessionID, messageID, abort signal
5. **Tool returns result** → Via Plugin hooks and Session.updatePart()
6. **Result stored** → Part updated with "completed" or "error" status
7. **Result serialized** → Via `toModelOutput()` for next prompt message
8. **Loop continues** → MessageV2.toModelMessage() includes tool results in next LLM call

---

## 3. AGENT EXECUTION LOOP

### 3.1 Main Agent Loop

**File**: `/Users/michael/opencode/packages/opencode/src/session/prompt.ts`

**Function**: `SessionPrompt.loop(sessionID)` (lines 232-612)

```
loop():
  while (true):
    // 1. Get current message state
    msgs = get all messages from session
    lastUser = last user message
    lastAssistant = last assistant message
    lastFinished = last finished assistant message
    
    // 2. Check if should exit
    if lastAssistant.finish && lastUser.id < lastAssistant.id:
      break
    
    // 3. Check for pending subtasks or compaction
    if task.type === "subtask":
      execute subtask with TaskTool
      continue
    
    if task.type === "compaction":
      compress old messages
      continue
    
    // 4. Resolve system prompt, tools, model params
    system = resolveSystemPrompt(agent, model)
    tools = resolveTools(agent, model)
    params = Plugin.trigger("chat.params", ...)
    
    // 5. CREATE LLM CALL
    processor = SessionProcessor.create({
      assistantMessage: new Assistant message with status
      sessionID, model, providerID, abort
    })
    
    result = processor.process(() =>
      streamText({
        model: model.language,
        messages: [system, ...toModelMessage(msgs)],
        tools: tools,
        ...params
      })
    )
    
    // 6. Handle result
    if result === "stop":
      break
    
  return last assistant message
```

### 3.2 Agent State Management

**State Location**: `SessionPrompt.state()` (lines 59-78)
- Maps sessionID → AbortController + callbacks
- Tracks ongoing execution per session
- Used to prevent concurrent execution (`assertNotBusy()`)

**Message State**: Stored in `/Users/michael/opencode/packages/opencode/src/storage/storage.ts`
- Path: `["message", sessionID, messageID]`
- Structure: UserMessage | AssistantMessage
- Each message has role, agent, model, timestamp

**Part State**: Stored as children of messages
- Path: `["part", messageID, partID]`
- Types: TextPart, ToolPart, ReasoningPart, StepStartPart, StepFinishPart, etc.

### 3.3 Execution Steps Tracking

**File**: `/Users/michael/opencode/packages/opencode/src/session/processor.ts`

**Step Count**: Tracked by `streamText({ stopWhen: stepCountIs(1) })`
- `stepCountIs(1)` from ai-sdk stops after first complete step

**Step Lifecycle** (in processor stream):

1. **start-step** (line 231-239):
   - Snapshot created via `Snapshot.track()`
   - Part type="step-start" stored

2. **finish-step** (lines 242-280):
   - Usage calculated: `Session.getUsage()`
   - Tokens & cost updated on message
   - Part type="step-finish" stored with:
     - tokens: { input, output, reasoning, cache: {read, write} }
     - cost: calculated cost
     - finishReason
   - Snapshot diff calculated
   - Message updated with token/cost info

### 3.4 Agent Decision Logic

**File**: `/Users/michael/opencode/packages/opencode/src/session/prompt.ts`

**Where Agent Decides What To Do**:

1. **Exit condition** (lines 268-275):
   - Check: `lastAssistant?.finish && !["tool-calls", "unknown"].includes(finish) && lastUser.id < lastAssistant.id`
   - finish reasons: "stop", "length", "content-filter", "function-calls" (old), "tool-calls"

2. **First step title generation** (lines 277-285):
   - `ensureTitle()` called once per session

3. **Subtask handling** (lines 292-397):
   - If pending subtask part detected, execute with TaskTool
   - Continue loop

4. **Compaction check** (lines 400-413):
   - If pending compaction part, process via SessionCompaction
   - Continue loop

5. **Overflow check** (lines 417-428):
   - `SessionCompaction.isOverflow()` checks if tokens exceed model limit
   - Creates compaction task if needed
   - Continue loop

6. **Normal processing** (lines 430-600):
   - Execute normal step via `processor.process()`
   - Loop continues if tool calls present or more work needed

### 3.5 Task Start & End

**Task Start**: Message Creation
- File: `/Users/michael/opencode/packages/opencode/src/session/prompt.ts` (lines 437-459)
- Creates Assistant message via `Session.updateMessage()`
- status: "assistant", mode: agent.name, time.created: now

**Task End**: Processor Completion
- File: `/Users/michael/opencode/packages/opencode/src/session/processor.ts` (lines 371-375)
- Sets `assistantMessage.time.completed = Date.now()`
- Updates message via `Session.updateMessage()`
- Returns "stop" or "continue"

---

## 4. MESSAGE & CONVERSATION MANAGEMENT

### 4.1 Message Storage Architecture

**File**: `/Users/michael/opencode/packages/opencode/src/session/message-v2.ts`

**Message Schema** (lines 284-371):

```typescript
// User message
User = {
  id: string
  sessionID: string
  role: "user"
  time: { created: number }
  summary?: { title?, body?, diffs }
  agent: string
  model: { providerID, modelID }
  system?: string
  tools?: Record<string, boolean>
}

// Assistant message
Assistant = {
  id: string
  sessionID: string
  role: "assistant"
  time: { created: number, completed?: number }
  error?: Error
  parentID: string (refs user message)
  modelID: string
  providerID: string
  mode: string (agent name)
  path: { cwd, root }
  cost: number
  tokens: { input, output, reasoning, cache: {read, write} }
  finish?: string (finish reason)
}
```

### 4.2 Message History Building

**File**: `/Users/michael/opencode/packages/opencode/src/session/prompt.ts` (lines 559-581)

```typescript
// Build message history for LLM
messages: [
  // 1. System messages
  ...system.map(x => ({ role: "system", content: x })),
  
  // 2. Conversation history
  ...MessageV2.toModelMessage(
    msgs.filter(m => {
      // Filter out failed assistant messages (unless they have tool calls)
      if (m.info.role !== "assistant" || m.info.error === undefined) {
        return true
      }
      if (
        MessageV2.AbortedError.isInstance(m.info.error) &&
        m.parts.some(part => part.type !== "step-start" && part.type !== "reasoning")
      ) {
        return true
      }
      return false
    })
  ),
]
```

### 4.3 Message Accumulation

**File**: `/Users/michael/opencode/packages/opencode/src/session/message-v2.ts` (lines 551-668)

**`toModelMessage()` Function** - Converts internal message format to LLM format:

1. **For User Messages**:
   - Text parts → UIMessage text parts
   - Non-plain-text files → UIMessage file parts (with mediaType)
   - Compaction parts → Special "What did we do so far?" text
   - Subtask parts → Special text indicator

2. **For Assistant Messages**:
   - Text parts → UIMessage text parts with metadata
   - Reasoning parts → UIMessage reasoning parts
   - Tool parts (completed) → `tool-{toolName}` parts with:
     - toolCallId
     - input: tool parameters
     - output: tool result (or "[Old tool result content cleared]" if compacted)
   - Tool parts (error) → `tool-{toolName}` error parts

3. **Final conversion**: `convertToModelMessages(result)`
   - From ai-sdk library
   - Converts UIMessage[] to ModelMessage[]

### 4.4 Message Storage & Retrieval

**Storage Path Structure**:
```
["message", sessionID, messageID] → Message.Info
["part", messageID, partID] → Message.Part
```

**Key Functions** (in `/Users/michael/opencode/packages/opencode/src/session/index.ts`):

1. **updateMessage()** (lines 344-350):
   - `Storage.write(["message", sessionID, id], msg)`
   - Publishes `MessageV2.Event.Updated`

2. **updatePart()** (lines 379-388):
   - `Storage.write(["part", messageID, id], part)`
   - Publishes `MessageV2.Event.PartUpdated` with optional delta

3. **messages()** (lines 287-301):
   - Streams all messages from session
   - Returns as `MessageV2.WithParts[]` (message + all parts)
   - Can limit number returned

4. **stream()** (lines 670-678):
   - Generator function, yields messages in reverse order
   - Used to build history

### 4.5 Part Types (Message Components)

**Complete Part Type Enum**:
- `TextPart`: Regular text output
- `ReasoningPart`: Extended thinking
- `ToolPart`: Tool call/execution
- `FilePart`: File attachment/reference
- `StepStartPart`: Boundary marker
- `StepFinishPart`: Boundary with tokens/cost
- `SnapshotPart`: Filesystem snapshot
- `PatchPart`: File modifications
- `AgentPart`: Agent reference
- `SubtaskPart`: Subtask definition
- `RetryPart`: Retry tracking
- `CompactionPart`: Compaction marker

### 4.6 Message Filtering & Compaction

**Message Filtering** (lines 568-579 in prompt.ts):
- Skip erroneous assistant messages
- Keep aborted messages if they have tool calls

**Compaction** (file: `/Users/michael/opencode/packages/opencode/src/session/compaction.ts`):
- Triggered when context exceeds model limit
- Calls `generateText()` to summarize old messages
- Replaces old tool results with "[Old tool result content cleared]"
- Prevents unbounded message growth

---

## Summary: Where to Inject Trajectory Recording

### Critical Injection Points:

1. **LLM Calls**:
   - `streamText()` in `/Users/michael/opencode/packages/opencode/src/session/prompt.ts` (line 508)
   - Wrap the parameters + stream result

2. **Tool Execution**:
   - Tool `execute()` wrapper in `resolveTools()` (lines 666-725)
   - Capture input/output/duration

3. **Agent Loop State**:
   - `SessionPrompt.loop()` entry/exit (line 232)
   - Message history accumulation (lines 248, 559-581)
   - Step decisions (lines 268-428)

4. **Message Storage**:
   - `Session.updateMessage()` for agent messages (line 344)
   - `Session.updatePart()` for message parts (line 379)
   - `MessageV2.toModelMessage()` for history building (line 551)

5. **Processor Events**:
   - `SessionProcessor.create()` (line 436)
   - Stream event processing (lines 50-329 in processor.ts)
   - Each event type (text-delta, tool-call, tool-result, etc.)

