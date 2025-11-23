# Trajectory Recording Implementation Plan for OpenCode

## Executive Summary

This document provides a complete implementation plan for adding trajectory recording to OpenCode, similar to Trae Agent's functionality. The system will capture detailed LLM interactions, tool executions, and agent steps, writing them to JSONL files for analysis and debugging.

---

## 1. Architecture Overview

### 1.1 What We Need to Record

Based on analysis of the OpenCode codebase and Trae Agent's implementation, we need to capture:

1. **Session-level metadata**: Start time, end time, model, agent, success status
2. **LLM interactions**: All messages sent, responses received, token usage
3. **Agent steps**: State transitions, reasoning, decisions
4. **Tool executions**: Tool calls with arguments, execution time, results/errors
5. **Stream events**: Real-time events from the LLM (text, reasoning, tool calls)

### 1.2 Key Differences from Trae Agent

OpenCode has a different architecture than Trae Agent:

- **Multiple LLM call sites**: Not just agent loop, but also summary, compaction, agent generation, title generation
- **Event-driven architecture**: Uses `streamText()` with async event streams, not simple request/response
- **Message Parts system**: Messages are composed of typed Parts (TextPart, ToolPart, ReasoningPart, etc.)
- **No explicit "step" counter**: Steps are implicit in the loop iterations
- **Tools execute during stream processing**: Not after stream completes

### 1.3 Proposed Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TrajectoryRecorder                        │
│                                                              │
│  - Manages JSONL file writing                               │
│  - Buffers events in memory                                 │
│  - Flushes to disk periodically                             │
│  - One instance per session                                 │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        │                     │                     │
┌───────▼────────┐  ┌─────────▼────────┐  ┌────────▼────────┐
│  Session       │  │  SessionProcessor │  │  Tool           │
│  prompt.ts     │  │  processor.ts     │  │  prompt.ts      │
│                │  │                   │  │                 │
│  Records:      │  │  Records:         │  │  Records:       │
│  - LLM calls   │  │  - Stream events  │  │  - Tool exec    │
│  - Loop start  │  │  - Text/reasoning │  │  - Tool results │
│  - Loop end    │  │  - Tool events    │  │  - Timing       │
└────────────────┘  └───────────────────┘  └─────────────────┘
```

---

## 2. JSONL File Format

### 2.1 Format Choice: JSONL (JSON Lines)

Each line in the file is a complete JSON object representing one event:

```jsonl
{"type":"session_start","timestamp":1234567890,"sessionID":"abc123","agent":"general","model":{"provider":"anthropic","id":"claude-sonnet-4-20250514"}}
{"type":"llm_interaction","timestamp":1234567891,"messages":[...],"response":{...},"usage":{...}}
{"type":"tool_execution","timestamp":1234567892,"tool":"bash","input":{...},"output":{...}}
{"type":"session_end","timestamp":1234567900,"success":true,"exitReason":"completed"}
```

**Benefits**:
- Easy to append (just write new line)
- Easy to stream and parse (line by line)
- Easy to search/filter with command-line tools
- No need to load entire file into memory

### 2.2 Event Types and Schemas

#### Event Type 1: `session_start`
```typescript
{
  type: "session_start"
  timestamp: number              // Unix timestamp in ms
  sessionID: string
  agent: string                  // Agent name
  model: {
    provider: string             // "anthropic", "openai", etc.
    id: string                   // Model ID
  }
  workingDirectory: string       // CWD at session start
}
```

#### Event Type 2: `llm_interaction`
```typescript
{
  type: "llm_interaction"
  timestamp: number
  sessionID: string
  messageID: string              // Assistant message ID
  step: number                   // Loop iteration number

  // NEW: Distinguish between streaming and non-streaming calls
  interactionType: "stream" | "generate"
  purpose: "agent_step" | "title" | "summary" | "compaction"

  // Input to LLM
  input: {
    systemPrompts: string[]      // System messages
    messages: ModelMessage[]     // Converted message history
    toolCount: number            // Number of tools available
    toolNames: string[]          // Names of available tools
    parameters: {
      temperature?: number
      topP?: number
      maxOutputTokens?: number
    }
  }

  // Response from LLM (populated after stream completes)
  response: {
    finishReason: string         // "stop", "length", "tool-calls", etc.
    usage: {
      inputTokens: number
      outputTokens: number
      reasoningTokens?: number   // May be > 0 even if reasoningLength is 0 (OpenAI o1)
      cacheReadTokens?: number
      cacheWriteTokens?: number
    }
    textLength: number           // Length of generated text
    reasoningLength: number      // Length of reasoning text (0 for hidden reasoning)
    hasHiddenReasoning: boolean  // True for OpenAI o1/o3 where reasoning is not exposed
    toolCallCount: number        // Number of tool calls made
  }

  // Timing
  startTime: number
  endTime: number
  duration: number               // milliseconds
}
```

#### Event Type 3: `stream_event`
```typescript
{
  type: "stream_event"
  timestamp: number
  sessionID: string
  messageID: string
  step: number

  eventType: "start" | "text-delta" | "reasoning-delta" | "tool-call" |
             "tool-result" | "step-finish" | "finish"

  // Event-specific data (varies by eventType)
  data: {
    // For text-delta:
    text?: string

    // For reasoning-delta:
    reasoning?: string

    // For tool-call:
    toolName?: string
    toolCallId?: string
    input?: Record<string, any>

    // For tool-result:
    toolCallId?: string
    output?: string

    // For step-finish:
    finishReason?: string
    usage?: {...}
  }
}
```

#### Event Type 4: `tool_execution`
```typescript
{
  type: "tool_execution"
  timestamp: number
  sessionID: string
  messageID: string
  step: number

  tool: string                   // Tool name
  callID: string                 // Tool call ID

  // Input
  input: Record<string, any>     // Tool arguments

  // Execution
  status: "pending" | "running" | "completed" | "error"
  startTime: number
  endTime?: number
  duration?: number              // milliseconds

  // Output
  result?: {
    title: string
    output: string
    metadata?: any
    attachments?: Array<{
      type: string
      path: string
    }>
  }
  error?: {
    message: string
    code?: string
  }
}
```

#### Event Type 5: `agent_step`
```typescript
{
  type: "agent_step"
  timestamp: number
  sessionID: string
  step: number

  action: "loop_start" | "llm_call" | "tool_execution" | "compaction" |
          "subtask" | "exit_check" | "loop_end"

  state: {
    messageCount: number         // Total messages in history
    hasSnapshot: boolean         // Whether snapshot exists
    contextOverflow: boolean     // Whether compaction needed
  }

  // Decision information
  decision?: {
    type: "continue" | "exit" | "compact" | "subtask"
    reason?: string
  }
}
```

#### Event Type 6: `compaction`
```typescript
{
  type: "compaction"
  timestamp: number
  sessionID: string

  action: "start" | "prune" | "summarize" | "end"

  // For "start"
  trigger?: {
    reason: "context_overflow" | "manual"
    messageCount: number
    tokenCount: number
    contextLimit: number
  }

  // For "prune"
  pruneDetails?: {
    toolsPruned: number
    tokensSaved: number
    oldestCompactedMessageID: string
  }

  // For "summarize"
  summaryDetails?: {
    summaryMessageID: string
    originalMessageCount: number
    summarizedMessageCount: number
  }

  // For "end"
  result?: {
    success: boolean
    newMessageCount: number
    tokenReduction: number
  }
}
```

#### Event Type 7: `session_end`
```typescript
{
  type: "session_end"
  timestamp: number
  sessionID: string

  success: boolean
  exitReason: string             // "completed", "max_steps", "error", "aborted"

  summary: {
    totalSteps: number
    totalLLMCalls: number
    totalToolCalls: number
    totalTokens: {
      input: number
      output: number
      reasoning: number
    }
    totalDuration: number        // milliseconds
  }

  error?: {
    message: string
    type: string
  }
}
```

### 2.3 Example Complete Trajectory (JSONL)

```jsonl
{"type":"session_start","timestamp":1700000000000,"sessionID":"ses_abc123","agent":"general-purpose","model":{"provider":"anthropic","id":"claude-sonnet-4-20250514"},"workingDirectory":"/Users/test/project"}
{"type":"agent_step","timestamp":1700000000100,"sessionID":"ses_abc123","step":1,"action":"loop_start","state":{"messageCount":1,"hasSnapshot":false,"contextOverflow":false}}
{"type":"llm_interaction","timestamp":1700000000200,"sessionID":"ses_abc123","messageID":"msg_def456","step":1,"input":{"systemPrompts":["You are a helpful assistant..."],"messages":[{"role":"user","content":"Create a hello.py file"}],"toolCount":15,"toolNames":["bash","read","write","edit","grep","glob"],"parameters":{"temperature":1.0,"topP":0.95}},"response":{"finishReason":"tool-calls","usage":{"inputTokens":1500,"outputTokens":250,"reasoningTokens":0},"textLength":45,"reasoningLength":0,"toolCallCount":1},"startTime":1700000000200,"endTime":1700000002500,"duration":2300}
{"type":"stream_event","timestamp":1700000000250,"sessionID":"ses_abc123","messageID":"msg_def456","step":1,"eventType":"start","data":{}}
{"type":"stream_event","timestamp":1700000000300,"sessionID":"ses_abc123","messageID":"msg_def456","step":1,"eventType":"text-delta","data":{"text":"I'll create a hello.py file for you."}}
{"type":"stream_event","timestamp":1700000001000,"sessionID":"ses_abc123","messageID":"msg_def456","step":1,"eventType":"tool-call","data":{"toolName":"write","toolCallId":"call_xyz789","input":{"file_path":"/Users/test/project/hello.py","content":"print('Hello, World!')"}}}
{"type":"tool_execution","timestamp":1700000001100,"sessionID":"ses_abc123","messageID":"msg_def456","step":1,"tool":"write","callID":"call_xyz789","input":{"file_path":"/Users/test/project/hello.py","content":"print('Hello, World!')"},"status":"running","startTime":1700000001100}
{"type":"tool_execution","timestamp":1700000001250,"sessionID":"ses_abc123","messageID":"msg_def456","step":1,"tool":"write","callID":"call_xyz789","input":{"file_path":"/Users/test/project/hello.py","content":"print('Hello, World!')"},"status":"completed","startTime":1700000001100,"endTime":1700000001250,"duration":150,"result":{"title":"Created hello.py","output":"File created successfully","metadata":{"path":"/Users/test/project/hello.py","size":22}}}
{"type":"stream_event","timestamp":1700000001300,"sessionID":"ses_abc123","messageID":"msg_def456","step":1,"eventType":"tool-result","data":{"toolCallId":"call_xyz789","output":"File created successfully"}}
{"type":"stream_event","timestamp":1700000002500,"sessionID":"ses_abc123","messageID":"msg_def456","step":1,"eventType":"step-finish","data":{"finishReason":"tool-calls","usage":{"inputTokens":1500,"outputTokens":250}}}
{"type":"agent_step","timestamp":1700000002600,"sessionID":"ses_abc123","step":1,"action":"loop_end","state":{"messageCount":2,"hasSnapshot":false,"contextOverflow":false},"decision":{"type":"continue","reason":"tool_results_added"}}
{"type":"agent_step","timestamp":1700000002700,"sessionID":"ses_abc123","step":2,"action":"loop_start","state":{"messageCount":2,"hasSnapshot":false,"contextOverflow":false}}
{"type":"llm_interaction","timestamp":1700000002800,"sessionID":"ses_abc123","messageID":"msg_ghi101","step":2,"input":{"systemPrompts":["You are a helpful assistant..."],"messages":[{"role":"user","content":"Create a hello.py file"},{"role":"assistant","content":[{"type":"tool-call","toolName":"write"}]},{"role":"tool-result","toolCallId":"call_xyz789","result":"File created successfully"}],"toolCount":15,"toolNames":["bash","read","write","edit","grep","glob"],"parameters":{"temperature":1.0,"topP":0.95}},"response":{"finishReason":"stop","usage":{"inputTokens":1800,"outputTokens":50},"textLength":35,"reasoningLength":0,"toolCallCount":0},"startTime":1700000002800,"endTime":1700000003500,"duration":700}
{"type":"stream_event","timestamp":1700000002850,"sessionID":"ses_abc123","messageID":"msg_ghi101","step":2,"eventType":"start","data":{}}
{"type":"stream_event","timestamp":1700000002900,"sessionID":"ses_abc123","messageID":"msg_ghi101","step":2,"eventType":"text-delta","data":{"text":"I've created hello.py successfully!"}}
{"type":"stream_event","timestamp":1700000003500,"sessionID":"ses_abc123","messageID":"msg_ghi101","step":2,"eventType":"step-finish","data":{"finishReason":"stop","usage":{"inputTokens":1800,"outputTokens":50}}}
{"type":"agent_step","timestamp":1700000003600,"sessionID":"ses_abc123","step":2,"action":"exit_check","state":{"messageCount":3,"hasSnapshot":false,"contextOverflow":false},"decision":{"type":"exit","reason":"task_completed"}}
{"type":"session_end","timestamp":1700000003700,"sessionID":"ses_abc123","success":true,"exitReason":"completed","summary":{"totalSteps":2,"totalLLMCalls":2,"totalToolCalls":1,"totalTokens":{"input":3300,"output":300,"reasoning":0},"totalDuration":3700}}
```

---

## 3. Implementation Plan

### 3.1 Files to Create

#### 1. `/packages/opencode/src/trajectory/types.ts`
Define all TypeScript types for trajectory events.

```typescript
export namespace Trajectory {
  export type Event =
    | SessionStartEvent
    | LLMInteractionEvent
    | StreamEvent
    | ToolExecutionEvent
    | AgentStepEvent
    | SessionEndEvent

  export interface SessionStartEvent {
    type: "session_start"
    timestamp: number
    sessionID: string
    agent: string
    model: {
      provider: string
      id: string
    }
    workingDirectory: string
  }

  // ... other event types
}
```

#### 2. `/packages/opencode/src/trajectory/recorder.ts`
Core trajectory recorder implementation.

```typescript
export namespace TrajectoryRecorder {
  // Internal state: Map<sessionID, Recorder>
  const recorders = new Map<string, Recorder>()

  class Recorder {
    private sessionID: string
    private filePath: string
    private buffer: Trajectory.Event[]
    private stream: WriteStream | null
    private startTime: number
    private stats: Statistics
    private flushStrategy: "immediate" | "end_of_stream" | "buffered"

    constructor(sessionID: string, options: {
      filePath?: string           // Optional override, uses config by default
      agent: string
      model: string
    })

    // Core methods
    record(event: Trajectory.Event): Promise<void>  // Async, may flush
    flush(): Promise<void>
    close(): Promise<void>

    // Flush control for stream-based flushing
    markStreamStart(): void       // Called when LLM stream begins
    markStreamEnd(): Promise<void>  // Called when LLM stream ends - triggers flush

    // Convenience methods for specific events
    recordSessionStart(data: ...): Promise<void>
    recordLLMInteraction(data: ...): Promise<void>
    recordStreamEvent(data: ...): Promise<void>
    recordToolExecution(data: ...): Promise<void>
    recordAgentStep(data: ...): Promise<void>
    recordCompaction(data: ...): Promise<void>
    recordSessionEnd(data: ...): Promise<void>
  }

  // Public API
  export function start(sessionID: string, options: {
    agent: string
    model: { provider: string; id: string }
    filePath?: string             // Optional override
  }): void

  export function record(sessionID: string, event: Trajectory.Event): Promise<void>
  export function stop(sessionID: string): Promise<void>
  export function isRecording(sessionID: string): boolean
  export function markStreamStart(sessionID: string): void
  export function markStreamEnd(sessionID: string): Promise<void>

  // Error handling - FAIL FAST
  // If trajectory recording fails, throw error and halt agent execution
  // This ensures we never lose trajectory data
}
```

#### 3. `/packages/opencode/src/trajectory/index.ts`
Public exports.

```typescript
export { TrajectoryRecorder } from "./recorder"
export type { Trajectory } from "./types"
```

#### 4. `/packages/opencode/src/trajectory/config.ts`
Configuration for trajectory recording.

```typescript
export namespace TrajectoryConfig {
  export interface Options {
    enabled: boolean               // Default: true (ALWAYS ON unless disabled)
    outputPath: string             // Configurable: Default ".opencode/trajectories"
    filenameTemplate: string       // Configurable: Default "trajectory_{sessionID}_{timestamp}.jsonl"
                                   // Variables: {sessionID}, {timestamp}, {agent}, {model}
    bufferSize: number             // Default: 100 events
    flushStrategy: "immediate" | "end_of_stream" | "buffered"
                                   // Default: "end_of_stream" - flush after each LLM stream completes
    captureStreamEvents: boolean   // Default: true (capture all text-delta, reasoning-delta events)
    captureToolDetails: boolean    // Default: true (capture full tool args and results)
  }

  export function get(): Options
  export function set(options: Partial<Options>): void

  // Helper to resolve filename template
  export function resolveFilename(sessionID: string, context: {
    agent: string
    model: string
    timestamp: number
  }): string
}
```

### 3.2 Additional LLM Call Sites (generateText vs streamText)

OpenCode uses TWO different patterns for LLM calls:

1. **streamText()** - Streaming responses with event processing:
   - Main agent loop (`prompt.ts:508`) - Primary agent steps
   - Compaction (`compaction.ts:132`) - Summarizing old messages

2. **generateText()** - Non-streaming, returns complete response:
   - Title generation (`summary.ts:86-108`) - Creates message titles with small model
   - Summary generation (`summary.ts:131-150`) - Creates message summaries with small model

**Key Implementation Difference**:
- `streamText()` calls: Use `markStreamStart()` / `markStreamEnd()` for flush control
- `generateText()` calls: Record start event, await completion, record end event (no stream markers)

**These must all be recorded** to have a complete trajectory. See TRAJECTORY_RECORDING_FAQ.md for details.

### 3.3 Files to Modify

#### 1. `/packages/opencode/src/session/prompt.ts`

**Injection Point 1: Session start** (around line 193)
```typescript
export const prompt = fn(PromptInput, async (input) => {
  const session = await Session.get(input.sessionID)
  await SessionRevert.cleanup(session)

  // INJECT: Record session start
  if (TrajectoryRecorder.isRecording(input.sessionID)) {
    const agent = await Agent.get(session.agent)
    const model = await Provider.getModel(session.provider, session.model)

    TrajectoryRecorder.record(input.sessionID, {
      type: "session_start",
      timestamp: Date.now(),
      sessionID: input.sessionID,
      agent: agent.name,
      model: {
        provider: model.providerID,
        id: model.modelID,
      },
      workingDirectory: process.cwd(),
    })
  }

  const message = await createUserMessage(input)
  await Session.touch(input.sessionID)

  if (input.noReply) {
    return message
  }

  return loop(input.sessionID)
})
```

**Injection Point 2: Loop start/end** (around lines 232-612)
```typescript
export async function loop(sessionID: string, opts?: {...}) {
  let step = 0

  while (true) {
    step++

    // INJECT: Record loop start
    if (TrajectoryRecorder.isRecording(sessionID)) {
      TrajectoryRecorder.record(sessionID, {
        type: "agent_step",
        timestamp: Date.now(),
        sessionID,
        step,
        action: "loop_start",
        state: {
          messageCount: msgs.length,
          hasSnapshot: !!snapshot,
          contextOverflow: false, // TODO: detect this
        },
      })
    }

    // ... existing loop logic ...

    // INJECT: Record LLM call start
    const llmStartTime = Date.now()
    if (TrajectoryRecorder.isRecording(sessionID)) {
      TrajectoryRecorder.record(sessionID, {
        type: "llm_interaction",
        timestamp: llmStartTime,
        sessionID,
        messageID: assistantMessage.id,
        step,
        input: {
          systemPrompts: system,
          messages: msgs.map(simplifyMessage), // Helper to remove sensitive data
          toolCount: Object.keys(tools).length,
          toolNames: Object.keys(tools),
          parameters: {
            temperature: params.temperature,
            topP: params.topP,
            maxOutputTokens: params.maxOutputTokens,
          },
        },
        startTime: llmStartTime,
        // response will be filled in after stream completes
      })
    }

    // Call streamText
    const result = await processor.process(() => streamText({...}))

    // INJECT: Record LLM call end
    if (TrajectoryRecorder.isRecording(sessionID)) {
      const llmEndTime = Date.now()
      // Get usage from result
      const usage = await Session.getUsage(assistantMessage.id)

      TrajectoryRecorder.record(sessionID, {
        type: "llm_interaction",
        timestamp: llmEndTime,
        sessionID,
        messageID: assistantMessage.id,
        step,
        response: {
          finishReason: result.finishReason,
          usage: usage.tokens,
          textLength: /* calculate from parts */,
          reasoningLength: /* calculate from parts */,
          toolCallCount: /* count tool parts */,
        },
        endTime: llmEndTime,
        duration: llmEndTime - llmStartTime,
      })
    }

    // Check exit conditions
    // INJECT: Record exit decision
    if (shouldExit) {
      if (TrajectoryRecorder.isRecording(sessionID)) {
        TrajectoryRecorder.record(sessionID, {
          type: "agent_step",
          timestamp: Date.now(),
          sessionID,
          step,
          action: "exit_check",
          decision: {
            type: "exit",
            reason: exitReason,
          },
        })

        TrajectoryRecorder.record(sessionID, {
          type: "session_end",
          timestamp: Date.now(),
          sessionID,
          success: true,
          exitReason: "completed",
          summary: await calculateSummary(sessionID),
        })

        await TrajectoryRecorder.stop(sessionID)
      }
      break
    }
  }
}
```

**Injection Point 3: Tool execution wrapper** (around lines 666-725)
```typescript
// Inside resolveTools()
execute: async (args, options) => {
  // INJECT: Record tool execution start
  const toolStartTime = Date.now()
  if (TrajectoryRecorder.isRecording(input.sessionID)) {
    TrajectoryRecorder.record(input.sessionID, {
      type: "tool_execution",
      timestamp: toolStartTime,
      sessionID: input.sessionID,
      messageID: input.processor.message.id,
      step: currentStep, // Need to track this
      tool: item.id,
      callID: options.toolCallId,
      input: args,
      status: "running",
      startTime: toolStartTime,
    })
  }

  // Execute the tool
  let result, error
  try {
    await Plugin.trigger("tool.execute.before", {...})
    result = await item.execute(args, {...})
    await Plugin.trigger("tool.execute.after", {...})
  } catch (e) {
    error = e
  }

  // INJECT: Record tool execution end
  const toolEndTime = Date.now()
  if (TrajectoryRecorder.isRecording(input.sessionID)) {
    TrajectoryRecorder.record(input.sessionID, {
      type: "tool_execution",
      timestamp: toolEndTime,
      sessionID: input.sessionID,
      messageID: input.processor.message.id,
      step: currentStep,
      tool: item.id,
      callID: options.toolCallId,
      input: args,
      status: error ? "error" : "completed",
      startTime: toolStartTime,
      endTime: toolEndTime,
      duration: toolEndTime - toolStartTime,
      result: error ? undefined : result,
      error: error ? { message: error.message } : undefined,
    })
  }

  if (error) throw error
  return result
}
```

#### 2. `/packages/opencode/src/session/processor.ts`

**Injection Point: Stream events** (around lines 49-329)
```typescript
for await (const value of stream.fullStream) {
  input.abort.throwIfAborted()

  // INJECT: Record stream event (optional, can be verbose)
  if (TrajectoryRecorder.isRecording(input.sessionID) &&
      TrajectoryConfig.get().captureStreamEvents) {
    TrajectoryRecorder.record(input.sessionID, {
      type: "stream_event",
      timestamp: Date.now(),
      sessionID: input.sessionID,
      messageID: input.assistantMessage.id,
      step: currentStep, // Need to pass this in
      eventType: value.type,
      data: extractEventData(value), // Helper to extract relevant data
    })
  }

  switch (value.type) {
    // ... existing event handlers ...
  }
}
```

#### 3. `/packages/opencode/src/session/index.ts`

**Add helper to calculate session summary**:
```typescript
export async function getTrajectorySummary(sessionID: string) {
  const messages = await MessageV2.stream(sessionID).toArray()

  let totalSteps = 0
  let totalLLMCalls = messages.filter(m => m.role === "assistant").length
  let totalToolCalls = 0
  let totalTokens = { input: 0, output: 0, reasoning: 0 }

  for (const msg of messages) {
    if (msg.role === "assistant") {
      const usage = await getUsage(msg.id)
      totalTokens.input += usage.tokens.input
      totalTokens.output += usage.tokens.output
      totalTokens.reasoning += usage.tokens.reasoning || 0

      const parts = await MessageV2.parts(msg.id)
      totalToolCalls += parts.filter(p => p.type === "tool").length
    }
  }

  return {
    totalSteps,
    totalLLMCalls,
    totalToolCalls,
    totalTokens,
    totalDuration: Date.now() - session.startTime,
  }
}
```

#### 4. `/packages/opencode/src/session/summary.ts`

**Injection Point 1: Title generation** (around line 86)
```typescript
// Before generateText call
if (TrajectoryRecorder.isRecording(sessionID)) {
  const startTime = Date.now()
  TrajectoryRecorder.record(sessionID, {
    type: "llm_interaction",
    timestamp: startTime,
    sessionID,
    messageID: assistantMsg.id,
    interactionType: "generate",
    purpose: "title",
    input: {
      systemPrompts: SystemPrompt.title(small.providerID),
      messages: [{ role: "user", content: textPart.text }],
      toolCount: 0,
      toolNames: [],
      parameters: { maxOutputTokens: small.info.reasoning ? 1500 : 20 },
    },
    startTime,
  })
}

const result = await generateText({...})

// After generateText returns
if (TrajectoryRecorder.isRecording(sessionID)) {
  TrajectoryRecorder.record(sessionID, {
    type: "llm_interaction",
    timestamp: Date.now(),
    sessionID,
    messageID: assistantMsg.id,
    interactionType: "generate",
    purpose: "title",
    response: {
      finishReason: result.finishReason,
      usage: result.usage,
      textLength: result.text.length,
      reasoningLength: 0,
      hasHiddenReasoning: false,
      toolCallCount: 0,
    },
    endTime: Date.now(),
    duration: Date.now() - startTime,
  })
}
```

**Injection Point 2: Summary generation** (around line 131)
```typescript
// Similar pattern as title generation
if (TrajectoryRecorder.isRecording(sessionID)) {
  TrajectoryRecorder.record(sessionID, {
    type: "llm_interaction",
    interactionType: "generate",
    purpose: "summary",
    // ... similar fields
  })
}

const result = await generateText({...})

if (TrajectoryRecorder.isRecording(sessionID)) {
  TrajectoryRecorder.record(sessionID, {
    type: "llm_interaction",
    interactionType: "generate",
    purpose: "summary",
    response: {...},
  })
}
```

#### 5. `/packages/opencode/src/session/compaction.ts`

**Injection Point 1: Compaction start** (before process call)
```typescript
// Before calling compaction
if (TrajectoryRecorder.isRecording(sessionID)) {
  TrajectoryRecorder.record(sessionID, {
    type: "compaction",
    timestamp: Date.now(),
    sessionID,
    action: "start",
    trigger: {
      reason: "context_overflow",
      messageCount: input.messages.length,
      tokenCount: calculateTokenCount(input.messages),
      contextLimit: model.limit.context,
    },
  })
}
```

**Injection Point 2: Prune operation** (in prune function)
```typescript
if (pruned > PRUNE_MINIMUM) {
  if (TrajectoryRecorder.isRecording(input.sessionID)) {
    TrajectoryRecorder.record(input.sessionID, {
      type: "compaction",
      timestamp: Date.now(),
      sessionID: input.sessionID,
      action: "prune",
      pruneDetails: {
        toolsPruned: toPrune.length,
        tokensSaved: pruned,
        oldestCompactedMessageID: toPrune[toPrune.length - 1].messageID,
      },
    })
  }

  for (const part of toPrune) {
    // ... existing prune logic
  }
}
```

**Injection Point 3: Compaction LLM call** (around line 132)
```typescript
// Before streamText in compaction
if (TrajectoryRecorder.isRecording(input.sessionID)) {
  TrajectoryRecorder.record(input.sessionID, {
    type: "llm_interaction",
    timestamp: Date.now(),
    sessionID: input.sessionID,
    messageID: msg.id,
    interactionType: "stream",
    purpose: "compaction",
    input: {
      systemPrompts: system,
      messages: MessageV2.toModelMessage(input.messages),
      toolCount: 0,
      toolNames: [],
    },
    startTime: Date.now(),
  })
}

const result = await processor.process(() => streamText({...}))

// After compaction completes
if (TrajectoryRecorder.isRecording(input.sessionID)) {
  TrajectoryRecorder.record(input.sessionID, {
    type: "compaction",
    timestamp: Date.now(),
    sessionID: input.sessionID,
    action: "end",
    result: {
      success: result !== "stop",
      newMessageCount: await getMessageCount(input.sessionID),
      tokenReduction: /* calculate */,
    },
  })
}
```

#### 6. `/packages/opencode/src/index.ts`

**Export trajectory module**:
```typescript
export { TrajectoryRecorder, type Trajectory } from "./trajectory"
```

### 3.3 Configuration Integration

Add trajectory configuration to the main config system:

**In config file** (e.g., `.opencode/config.json`):
```json
{
  "trajectory": {
    "enabled": true,
    "outputPath": ".opencode/trajectories",
    "filenameTemplate": "trajectory_{sessionID}_{timestamp}.jsonl",
    "flushStrategy": "end_of_stream",
    "captureStreamEvents": true,
    "captureToolDetails": true
  }
}
```

**Notes**:
- **Always on by default**: Recording is enabled unless explicitly disabled
- **Configurable path**: `outputPath` can be absolute or relative
- **Configurable filename**: Template supports variables:
  - `{sessionID}` - Session identifier
  - `{timestamp}` - Unix timestamp
  - `{agent}` - Agent name
  - `{model}` - Model ID (sanitized)
- **Flush strategy**: `end_of_stream` flushes after each LLM response completes
- **No redaction**: Records everything verbatim for complete debugging

**CLI flag** to override config:
```bash
# Use default config
opencode

# Disable trajectory recording
opencode --no-trajectory

# Override output path
opencode --trajectory-path=./debug/trajectories

# Override filename template
opencode --trajectory-file="debug_{sessionID}.jsonl"
```

### 3.4 Final Design Decisions Summary

Before implementation, these final decisions were made:

| Decision Area | Final Decision |
|---------------|----------------|
| **Storage Location** | Configurable via `outputPath` config option |
| **Filename** | Configurable via `filenameTemplate` with variables: `{sessionID}`, `{timestamp}`, `{agent}`, `{model}` |
| **Default Behavior** | **Always on** - Recording enabled by default |
| **Privacy/Redaction** | **Record everything verbatim** - No redaction, truncation, or sanitization |
| **Performance/Buffering** | Async writes with **flush at end of each LLM stream** (not per-event) |
| **Implementation Scope** | **Implement all 7 event types at once** - No incremental phases |
| **Schema Verbosity** | **Complete/verbose** - Capture full data for all events |
| **Error Handling** | **Fail fast** - Throw errors and halt execution if recording fails |

### 3.5 Implementation Steps

**IMPLEMENT ALL EVENTS AT ONCE** - No incremental phases

1. **Phase 1: Core Infrastructure**
   - [ ] Create `types.ts` with ALL 7 event type definitions
   - [ ] Create `recorder.ts` with complete Recorder class
     - [ ] Implement async buffer with end-of-stream flushing
     - [ ] Implement `markStreamStart()` / `markStreamEnd()` for flush control
     - [ ] Implement fail-fast error handling (throw on write errors)
     - [ ] Implement filename template resolution
   - [ ] Create `config.ts` with configuration management
     - [ ] Support `outputPath` (configurable directory)
     - [ ] Support `filenameTemplate` (configurable template with variables)
     - [ ] Support `flushStrategy` ("end_of_stream" default)
     - [ ] Default to enabled (always on)
   - [ ] Create `index.ts` with public exports
   - [ ] Add unit tests for recorder

2. **Phase 2: Complete Integration (All Event Types)**
   - [ ] **Session events** (`prompt.ts`):
     - [ ] Record `session_start` at session entry
     - [ ] Record `session_end` at loop exit
     - [ ] Auto-start recording for all sessions (enabled by default)

   - [ ] **Agent step events** (`prompt.ts`):
     - [ ] Add step counter to loop
     - [ ] Record `agent_step` (loop_start) at each iteration
     - [ ] Record `agent_step` (exit_check) when checking exit conditions
     - [ ] Record `agent_step` (loop_end) when loop continues

   - [ ] **LLM interaction events** (ALL call sites):
     - [ ] Main loop (`prompt.ts:508`): streamText for agent steps
     - [ ] Title generation (`summary.ts:86`): generateText for titles
     - [ ] Summary generation (`summary.ts:131`): generateText for summaries
     - [ ] Compaction (`compaction.ts:132`): streamText for compaction
     - [ ] Record start/end with full input/response data
     - [ ] Mark stream start/end for flush control
     - [ ] Include `interactionType` and `purpose` fields

   - [ ] **Tool execution events** (`prompt.ts:666-725`):
     - [ ] Record `tool_execution` (running) before tool executes
     - [ ] Record `tool_execution` (completed/error) after tool executes
     - [ ] Include full args and results (no redaction)
     - [ ] Pass step number to tool context

   - [ ] **Stream events** (`processor.ts:49-329`):
     - [ ] Record ALL stream event types:
       - [ ] `start`, `text-delta`, `reasoning-delta`
       - [ ] `tool-call`, `tool-result`
       - [ ] `step-finish`, `finish`
     - [ ] Include full event data (no truncation)
     - [ ] Controlled by `captureStreamEvents` config flag

   - [ ] **Compaction events** (`compaction.ts`):
     - [ ] Record `compaction` (start) with trigger details
     - [ ] Record `compaction` (prune) with pruning stats
     - [ ] Record `compaction` (summarize) when creating summary
     - [ ] Record `compaction` (end) with results

3. **Phase 3: Configuration & CLI**
   - [ ] Integrate with main config system
   - [ ] Add CLI flags:
     - [ ] `--no-trajectory` to disable
     - [ ] `--trajectory-path=<path>` to override output directory
     - [ ] `--trajectory-file=<template>` to override filename template
   - [ ] Set defaults (always on, `.opencode/trajectories/`)
   - [ ] Document all configuration options

4. **Phase 4: Error Handling & Reliability**
   - [ ] Implement fail-fast on write errors
   - [ ] Add try-catch around all recording calls
   - [ ] Throw meaningful errors when recording fails
   - [ ] Ensure buffer is flushed on process exit
   - [ ] Handle edge cases (disk full, permission denied, etc.)

5. **Phase 5: Testing**
   - [ ] Unit tests for all recorder methods
   - [ ] Integration tests for all event types
   - [ ] Test end-to-end session with all events
   - [ ] Test error scenarios (write failures)
   - [ ] Test configuration options
   - [ ] Test CLI flags

6. **Phase 6: Documentation**
   - [ ] Document configuration options
   - [ ] Document filename template variables
   - [ ] Document JSONL format and event schemas
   - [ ] Provide example trajectories
   - [ ] Document analysis/viewing tools

7. **Phase 7: Analysis Tools** (Future)
   - [ ] Create trajectory viewer tool
   - [ ] Create trajectory analyzer (token usage, timing)
   - [ ] Create trajectory comparison tool

---

## 4. Key Design Decisions

### 4.1 JSONL vs Single JSON
**Decision**: Use JSONL (JSON Lines) format
**Reasoning**:
- Easier to stream and append
- No need to load entire file into memory
- Simpler error recovery (corrupt line doesn't break file)
- Standard format with good tooling support

### 4.2 What to Record
**Decision**: Record EVERYTHING verbatim - NO redaction
**Reasoning**:
- Trajectory recording is for debugging - need complete data
- No truncation of file contents, tool outputs, or arguments
- No sanitization of paths or sensitive data
- Users can redact manually if needed for sharing

### 4.3 Where to Store Files
**Decision**: Configurable path with default `.opencode/trajectories/`
**Reasoning**:
- User can configure both directory AND filename template
- Default keeps trajectories in project directory
- Easy to add to `.gitignore`
- Template variables allow flexible naming (sessionID, timestamp, agent, model)

### 4.4 When to Flush
**Decision**: Flush at end of each LLM stream (not per-event)
**Reasoning**:
- Streaming allows batching events from single LLM response
- Reduces disk I/O while maintaining data integrity
- Can flush mid-stream if buffer gets too large
- Final flush on session end ensures no data loss

### 4.5 Always On by Default
**Decision**: Recording enabled by default unless explicitly disabled
**Reasoning**:
- Trajectory recording is a core feature for debugging
- Users must opt-out via `--no-trajectory` flag
- Ensures trajectories are available for troubleshooting
- Can be disabled via config for production deployments

### 4.6 Fail-Fast Error Handling
**Decision**: Throw errors and halt execution if recording fails
**Reasoning**:
- Trajectory recording is critical - not optional
- If recording fails, there may be deeper issues (disk full, permissions)
- Better to fail loudly than silently lose trajectory data
- Users can disable recording if they don't need it

### 4.7 Step Numbering
**Decision**: Add explicit step counter to loop
**Reasoning**:
- OpenCode doesn't have explicit steps like Trae Agent
- Need step numbers to correlate events
- Simple counter in loop is sufficient

### 4.8 Complete Schema
**Decision**: Capture complete/verbose data for all events
**Reasoning**:
- Full debugging requires complete information
- Don't optimize prematurely - can add sampling later if needed
- JSONL format is efficient enough for typical sessions
- Better to have too much info than too little

---

## 5. Testing Strategy

### 5.1 Unit Tests
- Test Recorder class methods
- Test event serialization/deserialization
- Test file writing and flushing
- Test buffer management

### 5.2 Integration Tests
- Test full session recording end-to-end
- Test trajectory file format validity
- Test with different session types:
  - Simple text-only session
  - Tool-heavy session
  - Multi-step reasoning session
  - Error/abort scenarios

### 5.3 Performance Tests
- Measure overhead of recording
- Test with stream event recording enabled/disabled
- Test memory usage with large sessions
- Test file I/O performance

### 5.4 Manual Testing
- Run sample sessions with recording enabled
- Verify JSONL file contents
- Use trajectory data for debugging real issues
- Test with different configuration options

---

## 6. Example Usage

### 6.1 Default Behavior (Always On)
```bash
# Recording is enabled by default
opencode

# Trajectory saved to: .opencode/trajectories/trajectory_{sessionID}_{timestamp}.jsonl
```

### 6.2 Disable Recording
```bash
# Disable trajectory recording
opencode --no-trajectory
```

### 6.3 Configure Output Location
```bash
# Override output directory
opencode --trajectory-path=./debug/trajectories

# Override filename template
opencode --trajectory-file="debug_{sessionID}_{agent}.jsonl"
```

### 6.4 Configure via Config File
```json
{
  "trajectory": {
    "enabled": true,
    "outputPath": "./my-trajectories",
    "filenameTemplate": "session_{sessionID}_{timestamp}.jsonl",
    "flushStrategy": "end_of_stream",
    "captureStreamEvents": true,
    "captureToolDetails": true
  }
}
```

### 6.5 Programmatic Usage
```typescript
import { TrajectoryRecorder } from "opencode"

// Recording starts automatically for all sessions (if enabled in config)

// To manually control recording:
TrajectoryRecorder.start(sessionID, {
  agent: "general-purpose",
  model: { provider: "anthropic", id: "claude-sonnet-4" },
  filePath: "./my-trajectory.jsonl"  // Optional override
})

// Recording happens automatically during session...
// Events are buffered and flushed at end of each LLM stream

// Stop recording (also flushes buffer)
await TrajectoryRecorder.stop(sessionID)
```

### 6.6 Analyzing Trajectories
```bash
# View all events
cat trajectories/trajectory_ses_abc123_1700000000.jsonl | jq

# Filter to LLM interactions only
cat trajectories/*.jsonl | grep '"type":"llm_interaction"' | jq

# Calculate total tokens
cat trajectories/*.jsonl | grep '"type":"session_end"' | jq '.summary.totalTokens'

# Extract tool executions
cat trajectories/*.jsonl | grep '"type":"tool_execution"' | jq 'select(.status=="completed")'

# Timeline view
cat trajectories/*.jsonl | jq -r '[.timestamp, .type] | @tsv' | sort -n
```

---

## 7. Future Enhancements

1. **Trajectory Viewer UI**: Web-based viewer for trajectories
2. **Trajectory Replay**: Replay session from trajectory file
3. **Trajectory Diff**: Compare trajectories to debug regressions
4. **Trajectory Analytics**: Aggregate statistics across multiple sessions
5. **Trajectory Export**: Export to other formats (CSV, Parquet)
6. **Trajectory Sampling**: Record only subset of events for performance
7. **Remote Trajectory Storage**: Send trajectories to remote server

---

## 8. Migration from Trae Agent

If migrating code/patterns from Trae Agent, key differences:

| Trae Agent | OpenCode | Notes |
|------------|----------|-------|
| `agent.execute_task()` | `SessionPrompt.loop()` | Different entry points |
| `step.state` | Implicit in loop | Add explicit step tracking |
| `tool_results` | `MessageV2.ToolPart` | Different tool result format |
| `llm_response` | Stream events | Need to reconstruct from stream |
| Single LLM client | Multiple call sites | Need to hook multiple locations |

---

## 9. Summary

This implementation plan provides a complete roadmap for adding trajectory recording to OpenCode. The key components are:

1. **New trajectory module** with recorder, types, and config
2. **Injection points** in prompt.ts, processor.ts, and session/index.ts
3. **JSONL format** for easy streaming and analysis
4. **Phased implementation** starting with core functionality
5. **Configuration options** for flexibility
6. **Testing strategy** to ensure quality

The implementation closely mirrors Trae Agent's approach but adapts to OpenCode's event-driven architecture and TypeScript codebase.

---

## Next Steps

1. Review this plan with the team
2. Get approval on JSONL format and event schemas
3. Start Phase 1: Core Infrastructure
4. Iterate through phases with testing at each step
5. Document usage for users
6. Gather feedback and iterate

---

## Appendix A: File Locations Quick Reference

### New Files
- `/packages/opencode/src/trajectory/types.ts`
- `/packages/opencode/src/trajectory/recorder.ts`
- `/packages/opencode/src/trajectory/config.ts`
- `/packages/opencode/src/trajectory/index.ts`

### Modified Files
- `/packages/opencode/src/session/prompt.ts` (4 injection points: session start, loop, LLM call, tool wrapper)
- `/packages/opencode/src/session/processor.ts` (1 injection point: stream events - optional)
- `/packages/opencode/src/session/index.ts` (1 helper function: getTrajectorySummary)
- `/packages/opencode/src/session/summary.ts` (2 injection points: title & summary generation)
- `/packages/opencode/src/session/compaction.ts` (3 injection points: start, prune, LLM call)
- `/packages/opencode/src/index.ts` (export trajectory module)

**Total: 6 files modified, ~11+ injection points**

### Configuration
- `.opencode/config.json` (add trajectory section)
- CLI flags: `--trajectory`, `--trajectory-file=<path>`

---

## Appendix B: Key Findings from Codebase Exploration

### LLM Call Sites
1. **Primary LLM call**: `prompt.ts:508` via `streamText()` - Main agent loop
2. **Title generation**: `summary.ts:86` via `generateText()` - Creates message titles
3. **Summary generation**: `summary.ts:131` via `generateText()` - Creates message summaries
4. **Compaction**: `compaction.ts:132` via `streamText()` - Summarizes old messages
5. **Stream processing**: `processor.ts:41-380` with event loop - Processes all stream events

### Key Behaviors
6. **Tool execution**: `prompt.ts:666-725` inside `resolveTools()` - Tool wrapper with hooks
7. **Message storage**: `MessageV2.Part` types in message-v2.ts - 12+ part types
8. **Session management**: `session/index.ts` with storage hooks - Persistent storage
9. **Reasoning handling**: `processor.ts:56-95` - Provider-dependent via AI SDK
10. **Compaction behavior**: Same session, adds summary message - Does NOT create new session

### Critical Findings
- **NOT all calls are streamed**: Both `streamText()` and `generateText()` are used
- **Reasoning is provider-dependent**: Claude exposes it, OpenAI o1/o3 hide it, DeepSeek includes in text
- **Compaction preserves session**: Session ID never changes, summary message inserted
- **Multiple injection points needed**: 6 files, 11+ locations

Full documentation in:
- `ARCHITECTURE_ANALYSIS.md` (638 lines)
- `ARCHITECTURE_DETAILED_REFERENCE.md` (635 lines)
- `TRAJECTORY_RECORDING_GUIDE.md` (541 lines)
- `TRAJECTORY_RECORDING_FAQ.md` (NEW - answers specific questions)
