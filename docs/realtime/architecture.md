# Architecture

## System Overview

The realtime integration adds a WebSocket-based transport layer that runs alongside the existing HTTP-based text mode.

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Client (TUI/Desktop/Web)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Audio Input  │  │ Audio Output │  │ WebSocket Client         │  │
│  │ (Microphone) │  │ (Speaker)    │  │ (realtime.ts)            │  │
│  └──────┬───────┘  └──────▲───────┘  └──────────┬───────────────┘  │
│         │                 │                      │                  │
│         └────────────┬────┴──────────────────────┘                  │
│                      │                                               │
└──────────────────────┼───────────────────────────────────────────────┘
                       │ WebSocket (wss://localhost:4096/realtime/:sessionID/connect)
                       │
┌──────────────────────┼───────────────────────────────────────────────┐
│ OpenCode Server      │                                               │
│  ┌───────────────────▼────────────────────────────────────────────┐  │
│  │ RealtimeRouter (/realtime/:sessionID/connect)                  │  │
│  │ - WebSocket upgrade handling                                   │  │
│  │ - Client <-> Provider message routing                          │  │
│  │ - Session state management                                     │  │
│  └───────────────────┬────────────────────────────────────────────┘  │
│                      │                                               │
│  ┌───────────────────▼────────────────────────────────────────────┐  │
│  │ RealtimeTransport (src/realtime/)                              │  │
│  │ - Provider-agnostic realtime abstraction                       │  │
│  │ - Event normalization                                          │  │
│  │ - Connection lifecycle management                              │  │
│  └───────────────────┬────────────────────────────────────────────┘  │
│                      │                                               │
│  ┌───────────────────▼────────────────────────────────────────────┐  │
│  │ OpenAIRealtimeTransport (src/realtime/openai-transport.ts)     │  │
│  │ - OpenAI Realtime API protocol                                 │  │
│  │ - WebSocket to wss://api.openai.com/v1/realtime                │  │
│  │ - Model: gpt-4o-realtime-preview                               │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

## Message Flow

### Audio Flow (User → Assistant)

```
1. Client captures microphone audio (24kHz PCM16)
2. Client sends audio chunks via WebSocket to opencode server
3. Server forwards to OpenAI Realtime API
4. OpenAI detects speech end via VAD
5. OpenAI generates response audio
6. Server receives audio chunks, forwards to client
7. Client plays audio through speakers
```

### Interruption Flow

```
1. Assistant is speaking (audio playing on client)
2. User starts speaking
3. OpenAI VAD detects user speech → sends speech_started event
4. Server forwards to client + sends response.cancel to OpenAI
5. Client stops playback immediately
6. OpenAI stops generating, waits for user input
7. User finishes speaking → speech_stopped event
8. OpenAI generates new response
```

## Module Structure

```
src/realtime/
├── protocol.ts          # Client↔Server message Zod schemas
├── openai-events.ts     # OpenAI Realtime API event types
├── transport.ts         # RealtimeTransport interface
├── openai-transport.ts  # OpenAI implementation
├── factory.ts           # Transport factory by provider
├── emitter.ts           # Typed event emitter
├── state.ts             # Connection state per instance
├── events.ts            # Bus events for realtime
├── errors.ts            # Error types
├── reconnect.ts         # Reconnection with backoff
└── tools.ts             # Tool conversion and execution

src/server/routes/
└── realtime.ts          # WebSocket route handler

src/session/
└── message-v2.ts        # Extended with AudioPart, RealtimeEventPart
```

## Provider Abstraction

The `RealtimeTransport` interface abstracts provider-specific implementations:

```typescript
interface RealtimeTransport {
  // Lifecycle
  connect(config: RealtimeConfig): Promise<void>
  disconnect(): Promise<void>

  // Audio I/O
  sendAudio(chunk: AudioChunk): void
  onAudio(handler: (chunk: AudioChunk) => void): void

  // Events
  onTranscript(handler: (text: string, role: Role, final: boolean) => void): void
  onVAD(handler: (event: VADEvent) => void): void
  onToolCall(handler: (call: ToolCall) => void): void
  respondToTool(callId: string, result: unknown): void

  // Control
  interrupt(): void
  updateSession(config: Partial<RealtimeConfig>): void
}
```

This allows future providers (Gemini Live, Azure) to implement the same interface.

## Server WebSocket Route

```typescript
// src/server/routes/realtime.ts

export const RealtimeRoutes = new Hono()
  .get("/:sessionID/connect", upgradeWebSocket((c) => ({
    onOpen(ws) {
      const sessionID = c.req.param("sessionID")
      const session = Session.get(sessionID)

      // Create transport for this session
      const transport = createRealtimeTransport(
        session.model.providerID,
        session.model.modelID,
        { apiKey: getApiKey(session.model.providerID) }
      )

      // Store in connection state
      ws.data = { sessionID, transport }

      // Wire up bidirectional event forwarding
      transport.onAudio((chunk) => ws.send(JSON.stringify({
        type: "audio.chunk", ...chunk
      })))

      transport.onTranscript((text, role, final) => {
        ws.send(JSON.stringify({
          type: final ? "transcript.final" : "transcript.partial",
          text, role
        }))
        if (final) {
          // Persist to session history
          RealtimeSession.saveTranscript(sessionID, { text, role })
        }
      })

      transport.onVAD((event) => {
        ws.send(JSON.stringify({ type: `vad.${event.type}` }))
      })

      transport.onToolCall(async (call) => {
        // Execute through existing tool system
        const result = await executeRealtimeTool(call.name, call.args, ctx)
        transport.respondToTool(call.callId, result)
      })

      // Connect to provider
      transport.connect(buildConfig(session))
    },

    onMessage(ws, message) {
      const { transport } = ws.data
      const msg = JSON.parse(message)

      switch (msg.type) {
        case "audio.chunk":
          transport.sendAudio(msg)
          break
        case "response.cancel":
          transport.interrupt()
          break
        case "session.update":
          transport.updateSession(msg.config)
          break
      }
    },

    onClose(ws) {
      ws.data.transport?.disconnect()
    }
  })))
```

## Session Integration

Realtime conversations integrate with the existing session system:

1. **Session Creation**: Same as text mode, but with realtime-capable model
2. **Message Persistence**: Transcripts saved as `AudioPart` in messages
3. **Tool Execution**: Same `Tool.execute()` pipeline, same permissions
4. **Cost Tracking**: Audio tokens tracked in session metrics

### Message Structure

```typescript
// User speaks
{
  role: "user",
  parts: [
    { type: "audio", transcript: "What's the weather?", duration: 2500 }
  ]
}

// Assistant responds
{
  role: "assistant",
  parts: [
    { type: "audio", transcript: "Let me check...", duration: 1200 },
    { type: "tool", tool: "get_weather", state: { status: "completed", ... } },
    { type: "audio", transcript: "It's 72°F and sunny.", duration: 2800 }
  ]
}
```

## Event Bus Integration

Realtime events are published to the existing Bus system:

```typescript
RealtimeEvent.SpeechStarted  // User began speaking
RealtimeEvent.SpeechStopped  // User stopped speaking
RealtimeEvent.Transcript     // Partial or final transcript
RealtimeEvent.AudioChunk     // Audio data for streaming
RealtimeEvent.ToolCall       // Tool invocation
RealtimeEvent.Connected      // WebSocket connected
RealtimeEvent.Disconnected   // WebSocket disconnected
```

This allows the TUI/Desktop apps to subscribe and update UI accordingly.
