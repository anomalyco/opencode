# SDK Choice: Raw WebSocket over Higher-Level SDKs

## Context

OpenCode currently uses the **Vercel AI SDK** for text-based LLM interactions. The Vercel AI SDK provides:
- `streamText()` for streaming responses
- Automatic tool call handling
- Provider abstraction

However, the Vercel AI SDK **does not support** the OpenAI Realtime API because:
1. Realtime uses WebSocket, not HTTP
2. Audio streaming is bidirectional and continuous
3. Tool calling flow differs from text mode

We needed to choose an approach for realtime integration.

## Options Evaluated

### Option 1: OpenAI Agents SDK

```typescript
import { Agent } from "@openai/agents";

const agent = new Agent({
  model: "gpt-4o-realtime-preview",
  tools: [...], // Agent SDK's tool format
});
```

| Pros | Cons |
|------|------|
| High-level, batteries included | Different tool format than opencode |
| Handles conversation state | Conflicts with opencode's session system |
| Built-in tool orchestration | Less control over audio buffering |
| | Opinionated about agent behavior |
| | Would need adapter layer for tools |

**Verdict**: ❌ Poor fit - would require significant adaptation and lose control.

### Option 2: @openai/realtime-api-beta SDK

```typescript
import { RealtimeClient } from "@openai/realtime-api-beta";

const client = new RealtimeClient({ apiKey });
client.addTool({
  name: "read_file",
  description: "Read a file",
  parameters: { type: "object", properties: { path: { type: "string" } } },
  async execute({ path }) {
    return await ReadTool.execute({ filePath: path }, ctx);
  }
});
```

| Pros | Cons |
|------|------|
| Typed events and helpers | Adds external dependency |
| Handles WebSocket lifecycle | Tool format differs from opencode |
| Built-in conversation mgmt | Still beta, API may change |
| Simpler than raw WebSocket | Less control over internals |

**Verdict**: ⚠️ Viable but adds friction and dependency.

### Option 3: Raw WebSocket + Custom Transport (Chosen)

```typescript
const ws = new WebSocket("wss://api.openai.com/v1/realtime?model=...");

ws.onmessage = (e) => {
  const event = JSON.parse(e.data);
  if (event.type === "response.function_call_arguments.done") {
    // Execute opencode tool directly
    const result = await Tool.execute(event.name, JSON.parse(event.arguments), ctx);
    ws.send(JSON.stringify({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: event.call_id, output: result }
    }));
    ws.send(JSON.stringify({ type: "response.create" }));
  }
};
```

| Pros | Cons |
|------|------|
| Full control over WebSocket | More code to write |
| Reuse existing tools as-is | Must handle reconnection |
| Fits opencode's architecture | Must implement event mapping |
| No external dependencies | |
| Optimized audio buffering | |

**Verdict**: ✅ Best fit - aligns with opencode's ownership philosophy.

## Decision

**Use raw WebSocket with a thin custom transport layer.**

### Rationale

1. **Reuse existing tool system**: OpenCode's `Tool.Info` with Zod schemas works unchanged. No adapter layer needed.

2. **Control over audio**: Fine-grained control over buffering, chunking, and latency optimization.

3. **Consistent architecture**: Follows opencode's pattern of owning abstractions rather than depending on external SDKs.

4. **No external dependencies**: Reduces version conflicts, breaking changes, and supply chain concerns.

5. **Future extensibility**: Same `RealtimeTransport` interface works for Gemini Live, Azure, etc.

### Trade-offs Accepted

1. **More implementation work**: We write the WebSocket handling, event mapping, and reconnection logic.

2. **Must track API changes**: OpenAI Realtime API is relatively new; we must monitor for breaking changes.

3. **Testing complexity**: Need to mock WebSocket connections in tests.

## Implementation Approach

### Transport Interface

```typescript
// src/realtime/transport.ts
interface RealtimeTransport {
  connect(config: RealtimeConfig): Promise<void>
  disconnect(): Promise<void>
  sendAudio(chunk: AudioChunk): void
  onAudio(handler: (chunk: AudioChunk) => void): void
  onTranscript(handler: (text: string, role: Role, final: boolean) => void): void
  onVAD(handler: (event: VADEvent) => void): void
  onToolCall(handler: (call: ToolCall) => void): void
  respondToTool(callId: string, result: unknown): void
  interrupt(): void
  updateSession(config: Partial<RealtimeConfig>): void
}
```

### OpenAI Implementation

```typescript
// src/realtime/openai-transport.ts
export class OpenAIRealtimeTransport implements RealtimeTransport {
  private ws: WebSocket | null = null
  private emitter = new TypedEmitter<TransportEvents>()

  async connect(config: RealtimeConfig): Promise<void> {
    const url = `wss://api.openai.com/v1/realtime?model=${config.model}`
    this.ws = new WebSocket(url, {
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "OpenAI-Beta": "realtime=v1"
      }
    })
    // ... event wiring
  }
}
```

### Tool Integration

```typescript
// Tools work unchanged - just convert Zod schema to JSON Schema
async function convertToolsForRealtime(tools: Tool.Info[]): Promise<OpenAITool[]> {
  return tools.map(tool => ({
    type: "function",
    name: tool.id,
    description: tool.description,
    parameters: z.toJSONSchema(tool.parameters)
  }))
}

// Execute through existing system
async function executeRealtimeTool(name: string, args: unknown, ctx: Tool.Context) {
  const tool = await ToolRegistry.get(name)
  const validated = tool.parameters.parse(args)
  return await tool.execute(validated, ctx)
}
```

## Comparison with Text Mode

| Aspect | Text Mode (Vercel AI SDK) | Realtime Mode (Raw WebSocket) |
|--------|---------------------------|-------------------------------|
| SDK | Vercel AI SDK `streamText()` | Custom WebSocket transport |
| Protocol | HTTP streaming | WebSocket |
| Tool definition | Same `Tool.Info` | Same `Tool.Info` |
| Tool execution | Same `Tool.execute()` | Same `Tool.execute()` |
| Permissions | Same `ctx.ask()` | Same `ctx.ask()` |
| Message parts | TextPart, ToolPart | AudioPart, ToolPart |

The key insight is that the **tool system is shared** - only the transport layer differs.
