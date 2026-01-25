# Tool Integration for Realtime

## Overview

OpenCode's existing tool system is reused for realtime mode with minimal changes. The key insight is that **tool definitions and execution are shared** - only the transport layer differs.

```
┌─────────────────────────────────────────────────────────────────┐
│                     OpenCode Tool System                         │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Tool.Info { id, init() → { description, parameters, execute } │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│              ┌───────────────┴───────────────┐                  │
│              ▼                               ▼                  │
│  ┌─────────────────────┐        ┌─────────────────────────────┐ │
│  │ Text Mode           │        │ Realtime Mode               │ │
│  │ (Vercel AI SDK)     │        │ (OpenAI Realtime WebSocket) │ │
│  │                     │        │                             │ │
│  │ streamText({        │        │ RealtimeTransport {         │ │
│  │   tools: convert(   │        │   tools: convert(           │ │
│  │     Tool.Info →     │        │     Tool.Info →             │ │
│  │     AI SDK format   │        │     OpenAI function format  │ │
│  │   )                 │        │   )                         │ │
│  │ })                  │        │ }                           │ │
│  └─────────────────────┘        └─────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              Shared: Tool.execute(args, context)            │ │
│  │              Shared: ToolPart state machine                 │ │
│  │              Shared: Permission system                      │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## When Are Tools Called?

### OpenAI Realtime API Behavior

The OpenAI Realtime API uses **server-side VAD** (Voice Activity Detection) to determine turn boundaries:

1. **User speaks** → Audio streamed to OpenAI
2. **User pauses** → VAD detects silence (configurable: `silence_duration_ms`)
3. **Model responds** → May include tool calls during response generation
4. **Tool results fed back** → Model continues response with tool output

**Important**: Tools are called **after** the user stops speaking, not during. The model cannot proactively call tools while the user is mid-sentence.

### Conversation Timeline

```
User speaking:     |████████████████|
VAD silence:                        |░░░|
Model thinking:                          |▒▒▒|
Tool call:                                   |████|  (read_file)
Tool execution:                                    |████████|
Model continues:                                              |████████████|
Audio output:                                     |▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓|
```

### Enabling "Proactive" Behavior

To achieve more seamless tool calling (e.g., agent starts reading a file as soon as user mentions it):

1. **Aggressive VAD settings**:
   ```typescript
   turnDetection: {
     type: "server_vad",
     threshold: 0.3,           // Lower = more sensitive
     silence_duration_ms: 300, // Shorter silence triggers turn end
     prefix_padding_ms: 200
   }
   ```

2. **Push-to-talk mode** (manual VAD):
   - User explicitly signals turn end
   - Useful in noisy environments
   - `turnDetection: { type: "none" }`

3. **Future: Semantic VAD** (not yet available):
   - Model detects natural sentence boundaries
   - Could enable mid-sentence tool calls

## Tool Call Flow in Realtime

```
1. User speaks: "Can you read the config file?"
   ↓
2. VAD detects silence → User turn ends
   ↓
3. OpenAI generates response, decides to call read_file
   ↓
4. Server receives: response.function_call_arguments.done
   {
     type: "response.function_call_arguments.done",
     call_id: "call_abc123",
     name: "read",
     arguments: '{"file_path": "/home/user/config.json"}'
   }
   ↓
5. Server creates ToolPart(pending), then ToolPart(running)
   ↓
6. Server calls: Tool.execute("read", { file_path: "..." }, ctx)
   - Same execution as text mode
   - Same permission checks (ctx.ask())
   - Same timeout handling
   ↓
7. Server sends tool result back:
   {
     type: "conversation.item.create",
     item: {
       type: "function_call_output",
       call_id: "call_abc123",
       output: '{"content": "file contents here..."}'
     }
   }
   ↓
8. Server triggers continuation:
   { type: "response.create" }
   ↓
9. OpenAI generates audio response incorporating tool result
   ↓
10. Server updates ToolPart(completed)
```

## Interruption Handling

### When User Interrupts During Tool Execution

```
Timeline:
  Model responding: |▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓|
  Tool call:              |████|
  Tool running:                |████████████|
  User speaks:                      |████████████|  ← INTERRUPTION
```

When user speaks while a tool is running:

1. **VAD detects speech** → `input_audio_buffer.speech_started`
2. **Server cancels response** → `response.cancel`
3. **Tool AbortSignal triggered** → Tool execution should abort
4. **ToolPart transitions to `interrupted`** state
5. **New user turn begins**

### New ToolState: `interrupted`

```typescript
export const ToolStateInterrupted = z.object({
  status: z.literal("interrupted"),
  input: z.record(z.string(), z.any()),
  reason: z.enum([
    "user_speech",      // User started speaking
    "response_cancel",  // Explicit cancellation
    "connection_lost"   // WebSocket disconnected
  ]),
  partialOutput: z.string().optional(), // If tool produced partial results
  time: z.object({
    start: z.number(),
    end: z.number(),
  }),
})
```

### Tool Interruption Implementation

```typescript
class RealtimeToolExecutor {
  private abortController: AbortController | null = null

  async execute(name: string, args: unknown, ctx: Tool.Context) {
    this.abortController = new AbortController()

    try {
      const result = await Tool.execute(name, args, {
        ...ctx,
        abort: this.abortController.signal
      })
      return result
    } catch (e) {
      if (e.name === "AbortError") {
        // Tool was interrupted
        return { interrupted: true, reason: "user_speech" }
      }
      throw e
    }
  }

  interrupt(reason: string) {
    this.abortController?.abort(reason)
  }
}
```

## Permission Handling in Realtime

The permission system works the same as text mode:

```typescript
// Tool calls ctx.ask() for permission
await ctx.ask({
  permission: "bash",
  patterns: ["rm -rf /tmp/*"],
  description: "Delete temporary files"
})
```

In realtime mode:
1. Tool execution pauses at permission request
2. Server sends permission request to client via WebSocket
3. Client shows permission dialog (voice or UI)
4. User grants/denies
5. Tool execution continues or fails

**Challenge**: Voice-based permission granting needs UX design:
- Could use specific phrases: "Yes, allow that" / "No, don't do that"
- Could fall back to UI buttons
- Could use confirmation beeps

## Tool Schema Conversion

Tools are converted from Zod schemas to OpenAI function format:

```typescript
// src/realtime/tools.ts

export async function convertToolsForRealtime(
  model: Provider.Model,
  agent: string
): Promise<OpenAIRealtimeTool[]> {
  const tools = await ToolRegistry.tools(model, agent)

  return tools.map(tool => ({
    type: "function",
    name: tool.id,
    description: tool.description,
    parameters: z.toJSONSchema(tool.parameters)
  }))
}
```

The conversion uses the same `z.toJSONSchema()` as text mode, ensuring consistent behavior.

## Differences from Text Mode

| Aspect | Text Mode | Realtime Mode |
|--------|-----------|---------------|
| Transport | HTTP streaming | WebSocket |
| Tool invocation | Callback in `streamText()` | Explicit event handling |
| Result delivery | Return from `execute()` | WebSocket message + `response.create` |
| Concurrent tools | Sequential | Can be parallel |
| Interruption | AbortSignal only | VAD + response.cancel + interrupted state |
| Feedback | Text response | Voice confirms execution |
| Timing | Immediate | After VAD silence detection |

## Best Practices for Realtime Tools

1. **Keep tools fast**: Long-running tools block the conversation flow
2. **Support AbortSignal**: Tools should check `ctx.abort` and exit cleanly
3. **Provide progress updates**: Use `ctx.metadata()` for long operations
4. **Handle partial results**: If interrupted, save what was completed
5. **Consider audio feedback**: Model can narrate tool execution status
