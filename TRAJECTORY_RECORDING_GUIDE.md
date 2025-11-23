# Trajectory Recording Implementation Guide for OpenCode

## Executive Summary

This document provides comprehensive guidance for implementing trajectory recording in the OpenCode codebase. The system needs to capture the complete flow of agent execution from user input through LLM calls, tool execution, and final results.

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Input                              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             v
┌─────────────────────────────────────────────────────────────────┐
│              SessionPrompt.prompt() Entry Point                │
│  - Creates user message with parts (text, files, etc.)         │
│  - Calls Session.updateMessage() & Session.updatePart()       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             v
┌─────────────────────────────────────────────────────────────────┐
│         SessionPrompt.loop() - Main Agent Loop Starts           │
│  - Retrieves conversation history via MessageV2.stream()       │
│  - Filters and converts messages via toModelMessage()          │
└────────────────────────────┬────────────────────────────────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
    ┌──────v──────┐  ┌──────v──────┐  ┌──────v──────┐
    │  Check for  │  │  Subtask    │  │ Compaction  │
    │   Exit      │  │  Handling   │  │   Handling  │
    │ Condition   │  │             │  │             │
    └─────────────┘  └─────────────┘  └─────────────┘
           │
           No, continue...
           │
           v
┌─────────────────────────────────────────────────────────────────┐
│    Resolve Chat Context:                                        │
│    1. System prompt via resolveSystemPrompt()                  │
│    2. Tools via resolveTools()                                 │
│    3. Parameters via Plugin.trigger("chat.params")             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             v
┌─────────────────────────────────────────────────────────────────┐
│  CREATE ASSISTANT MESSAGE & PROCESSOR                           │
│  - Session.updateMessage() creates empty Assistant message      │
│  - SessionProcessor.create() prepares stream handler            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             v
┌─────────────────────────────────────────────────────────────────┐
│         STREAMTEXT() - LLM API CALL                             │
│                                                                 │
│  Parameters passed:                                             │
│  - model: wrapLanguageModel({ model.language })               │
│  - messages: [system, ...toModelMessage(msgs)]                │
│  - tools: enabled tools definitions                           │
│  - temperature, topP, maxOutputTokens                         │
│  - providerOptions, headers                                   │
│                                                                 │
│  Returns: StreamTextResult yielding typed events              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             v
┌─────────────────────────────────────────────────────────────────┐
│         STREAM EVENT PROCESSING (SessionProcessor)              │
│                                                                 │
│  Events processed:                                              │
│  ├─ start: Stream begins                                       │
│  ├─ text-start/delta/end: Model text output                   │
│  ├─ reasoning-start/delta/end: Extended thinking              │
│  ├─ tool-input-start/delta/end: Tool params building          │
│  ├─ tool-call: LLM generated tool call                        │
│  ├─ tool-result: Tool execution completed                     │
│  ├─ tool-error: Tool execution failed                         │
│  ├─ step-start/finish: Step boundaries + usage tracking       │
│  └─ finish: Stream completion                                 │
│                                                                 │
│  Each event: Session.updatePart() stores message part         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                ┌────────────┼────────────┐
                │            │            │
           ┌────v────┐  ┌────v────┐  ┌──v─────┐
           │  Text   │  │  Tools  │  │ Finish │
           │ Stored  │  │ Results │  │ Reason │
           │  Part   │  │ Stored  │  │ Stored │
           └─────────┘  └─────────┘  └────────┘
                │
                └────────────────────────┬──────────────────────┐
                                         │                      │
                                   ┌─────v─────┐         ┌──────v──┐
                                   │  Continue │         │  STOP   │
                                   │   Loop    │         │ & Exit  │
                                   └─────┬─────┘         └─────────┘
                                         │
                                         v
                              (Next iteration with
                              tool results in history)
```

## Key Injection Points for Trajectory Recording

### Level 1: High-Level Trajectory (Recommended First)

#### 1.1 Session Entry Point
**File**: `/Users/michael/opencode/packages/opencode/src/session/prompt.ts`
**Function**: `prompt()` (line 193-205)

```typescript
// TRAJECTORY: Record session start
// Capture: sessionID, user input parts, agent name, model
export const prompt = fn(PromptInput, async (input) => {
  const session = await Session.get(input.sessionID)
  await SessionRevert.cleanup(session)

  const message = await createUserMessage(input)
  await Session.touch(input.sessionID)

  if (input.noReply) {
    return message
  }

  return loop(input.sessionID)
})
```

**What to record**:
- Session ID
- User message ID
- Input parts (text, files)
- Agent name
- Model (provider + ID)
- Timestamp

#### 1.2 Loop Entry/Exit
**File**: `/Users/michael/opencode/packages/opencode/src/session/prompt.ts`
**Function**: `loop()` (lines 232-612)

**Entry point** (line 232): Record loop start
- Track step number
- Current state before LLM call

**Exit point** (lines 268-275, 599-612): Record loop completion
- Final state
- Total steps taken
- Exit reason

### Level 2: LLM Call Details

#### 2.1 Before streamText() Call
**File**: `/Users/michael/opencode/packages/opencode/src/session/prompt.ts`
**Location**: Lines 465-507 (setup before streamText)

**What to record**:
```typescript
{
  type: "llm_call_start",
  sessionID,
  messageID: assistantMessage.id,
  timestamp: Date.now(),
  model: { providerID, modelID },
  agent: agent.name,
  step: step,
  
  // System prompt
  systemPrompt: system,
  
  // Message history
  messageCount: msgs.length,
  messageHistory: msgs.map(m => ({
    id: m.info.id,
    role: m.info.role,
    agent: m.info.role === 'user' ? m.info.agent : undefined,
    partCount: m.parts.length,
    partTypes: m.parts.map(p => p.type),
  })),
  
  // Parameters
  temperature: params.temperature,
  topP: params.topP,
  maxOutputTokens: ...,
  toolCount: Object.keys(tools).length,
  toolNames: Object.keys(tools),
}
```

**Injection Point**: Before line 508 (before `processor.process()`)

#### 2.2 Actual streamText Call
**File**: `/Users/michael/opencode/packages/opencode/src/session/prompt.ts`
**Location**: Lines 508-598

**What to record**: The complete parameters object passed to `streamText()`
```typescript
{
  type: "streamtext_call",
  timestamp: Date.now(),
  model: {
    provider: model.providerID,
    modelID: model.modelID,
    language: model.language.constructor.name, // SDK type
  },
  messageCount: messages.length,
  systemMessageCount: system.length,
  toolsEnabled: !!(tools && Object.keys(tools).length),
  temperature,
  topP,
  maxOutputTokens,
}
```

**Injection Point**: Middleware wrapper around `streamText()`

### Level 3: Stream Event Recording

#### 3.1 Processor Event Stream
**File**: `/Users/michael/opencode/packages/opencode/src/session/processor.ts`
**Function**: `process()` (lines 41-380)
**Event Loop**: Lines 49-329

Each event should be recorded:

```typescript
{
  type: "stream_event",
  eventType: value.type, // "start", "text-delta", "tool-call", etc.
  timestamp: Date.now(),
  
  // Event-specific data:
  // For tool-call:
  toolName: value.toolName,
  toolCallId: value.toolCallId,
  input: value.input,
  
  // For text-delta:
  text: value.text,
  textLength: value.text.length,
  
  // For tool-result:
  output: value.output.output,
  outputLength: value.output.output.length,
  
  // For step-finish:
  finishReason: value.finishReason,
  usage: value.usage,
}
```

**Key Events to Record**:
- `start` (line 52)
- `reasoning-delta` (line 73)
- `text-delta` (line 296)
- `tool-input-end` (line 117)
- `tool-call` (line 120)
- `tool-result` (line 180)
- `tool-error` (line 204)
- `step-start` (line 231)
- `finish-step` (line 242)

### Level 4: Tool Execution Details

#### 4.1 Tool Execution Wrapper
**File**: `/Users/michael/opencode/packages/opencode/src/session/prompt.ts`
**Location**: Lines 666-725 (inside `resolveTools()`)

**Record tool execution**:
```typescript
{
  type: "tool_execution",
  toolId: item.id,
  callId: options.toolCallId,
  sessionID: input.sessionID,
  messageID: input.processor.message.id,
  
  // Before execution
  startTime: Date.now(),
  args: args,
  
  // During/After execution
  status: "running" | "completed" | "error",
  endTime: Date.now(),
  duration: endTime - startTime,
  
  // Result
  result: result,
  error: error?.message,
}
```

**Injection Points**:
1. Before `Plugin.trigger("tool.execute.before", ...)` (line 671)
2. Before `item.execute(args, ...)` (line 682)
3. After result/error received

#### 4.2 Tool Result Recording
**File**: `/Users/michael/opencode/packages/opencode/src/session/processor.ts`
**Location**: Lines 180-226

Record both successful and failed tool results with full details

### Level 5: Message Storage

#### 5.1 Message Updates
**File**: `/Users/michael/opencode/packages/opencode/src/session/index.ts`
**Functions**:
- `updateMessage()` (line 344)
- `updatePart()` (line 379)

**Record all updates**:
```typescript
{
  type: "message_update" | "part_update",
  timestamp: Date.now(),
  messageID: msg.id,
  partID: part?.id,
  messageRole: msg.role,
  messageAgent: msg.agent,
  partType: part?.type,
  change: {
    before: previousState,
    after: newState,
  },
}
```

### Level 6: Token & Cost Tracking

#### 6.1 Usage Calculation
**File**: `/Users/michael/opencode/packages/opencode/src/session/index.ts`
**Function**: `getUsage()` (line 390-441)

**Record**:
```typescript
{
  type: "usage_calculated",
  timestamp: Date.now(),
  messageID,
  tokens: {
    input,
    output,
    reasoning,
    cache: { read, write },
  },
  cost,
  model: model.id,
}
```

---

## Trajectory Recording Strategy

### Recommended Implementation Approach

1. **Create a new module**: `/Users/michael/opencode/packages/opencode/src/trajectory/recorder.ts`

```typescript
namespace TrajectoryRecorder {
  interface TrajectoryEvent {
    type: string
    timestamp: number
    sessionID: string
    // ... other fields
  }
  
  const buffer: TrajectoryEvent[] = []
  
  export function record(event: TrajectoryEvent) {
    buffer.push(event)
    // Optional: persist to storage
  }
  
  export function flush(sessionID: string) {
    // Save trajectory to storage
    // Return events
  }
}
```

2. **Add hooks at each level** (see injection points above)

3. **Store trajectory data**:
   - In-memory during session
   - Storage: `["trajectory", sessionID]`
   - Query: API to retrieve trajectory

4. **API endpoints to expose**:
   - GET `/session/:id/trajectory` - full trajectory
   - GET `/session/:id/trajectory/events` - just events
   - GET `/session/:id/trajectory/summary` - summary stats

### Data Structure

```typescript
Trajectory = {
  sessionID: string
  startTime: number
  endTime: number
  events: TrajectoryEvent[]
  summary: {
    totalSteps: number
    totalTools: number
    totalTokens: number
    totalCost: number
    exitReason: string
  }
}

TrajectoryEvent = {
  timestamp: number
  type: "session_start" | "llm_call_start" | "stream_event" | "tool_start" | ...
  step?: number
  data: Record<string, any>
}
```

---

## Storage Strategy

### Option 1: Append to Existing Storage
Extend `MessageV2.Part` with trajectory marker parts:
```typescript
TrajectoryMarkerPart = {
  type: "trajectory_event"
  eventType: string
  data: any
}
```

### Option 2: Separate Storage
New storage namespace:
```
["trajectory", sessionID, eventID] → TrajectoryEvent
```

### Option 3: Session-Level Metadata
Add trajectory array to Session.Info:
```typescript
Session.Info = {
  // ... existing fields
  trajectory?: {
    events: TrajectoryEvent[]
    summary: TrajectoryStats
  }
}
```

---

## Query & Analysis APIs

### Retrieve Trajectory
```typescript
// Get complete trajectory
const trajectory = await Trajectory.get(sessionID)

// Get specific event type
const toolEvents = await Trajectory.getEvents(sessionID, "tool_*")

// Get trajectory summary
const stats = await Trajectory.getSummary(sessionID)

// Export trajectory
const json = await Trajectory.export(sessionID)
```

### Analysis Examples
```typescript
// Timeline view
trajectory.events.map(e => ({
  time: e.timestamp,
  type: e.type,
  duration: nextEvent?.timestamp - e.timestamp
}))

// Tool execution breakdown
toolEvents.reduce((acc, e) => {
  acc[e.data.toolId] = (acc[e.data.toolId] || 0) + e.data.duration
  return acc
}, {})

// LLM call details
llmEvents.map(e => ({
  model: e.data.model,
  tokens: e.data.usage.total,
  cost: e.data.cost,
  duration: e.data.duration
}))
```

---

## Performance Considerations

1. **Memory**: Buffer events in-memory, flush periodically
2. **Storage**: Compress trajectory JSON before storage
3. **Query**: Index by sessionID for fast retrieval
4. **Filtering**: Allow event type filtering to reduce data

---

## Testing Strategy

1. **Unit Tests**: Each recorder function
2. **Integration Tests**: Full trajectory capture for sample session
3. **Performance Tests**: Memory/storage impact
4. **E2E Tests**: Trajectory accuracy vs actual execution

---

## Files Created/Modified Summary

### New Files
- `/Users/michael/opencode/packages/opencode/src/trajectory/recorder.ts` - Core recording logic
- `/Users/michael/opencode/packages/opencode/src/trajectory/index.ts` - Namespace export
- `/Users/michael/opencode/packages/opencode/src/trajectory/types.ts` - Type definitions

### Modified Files
- `/Users/michael/opencode/packages/opencode/src/session/prompt.ts` - Add hooks
- `/Users/michael/opencode/packages/opencode/src/session/processor.ts` - Add event recording
- `/Users/michael/opencode/packages/opencode/src/session/index.ts` - Add message update hooks
- `/Users/michael/opencode/packages/opencode/src/index.ts` - Export Trajectory module

---

## Next Steps

1. Review this architecture document
2. Choose implementation approach (separate module vs integrated)
3. Define final data schema
4. Implement core recorder
5. Add hooks to injection points
6. Build query/export APIs
7. Add tests
8. Document for users

