# New Types for Realtime

This document describes the new TypeScript types needed for realtime voice support.

## Message Parts

### AudioPart

Represents audio content in a message (user speech or assistant response).

```typescript
// src/session/message-v2.ts

export const AudioPart = PartBase.extend({
  type: z.literal("audio"),
  transcript: z.string().optional(),      // STT transcript when available
  duration: z.number().optional(),        // Duration in milliseconds
  url: z.string().optional(),             // URL to audio file (for persistence)
  encoding: z.enum(["pcm16", "mp3", "opus"]).optional()
}).meta({ ref: "AudioPart" })

export type AudioPart = z.infer<typeof AudioPart>
```

**Comparison to existing parts:**

| Field | AudioPart | Similar To |
|-------|-----------|------------|
| `transcript` | Searchable text | `TextPart.text` |
| `url` | Optional media storage | `FilePart.url` |
| `duration` | Audio-specific timing | `ReasoningPart.time` |
| `encoding` | Format metadata | New concept |

**Why not use FilePart?**

`FilePart` is for static file attachments. `AudioPart` represents:
- Streaming audio that may not have a persistent URL
- Transcripts as first-class data (searchable, displayable)
- Duration tracking for audio metrics
- Encoding info needed for playback

### RealtimeEventPart

Represents VAD and conversation flow events.

```typescript
export const RealtimeEventPart = PartBase.extend({
  type: z.literal("realtime-event"),
  event: z.enum([
    "speech_started",    // User began speaking
    "speech_stopped",    // User stopped speaking
    "interrupted",       // User interrupted assistant
    "response_started"   // Assistant began responding
  ]),
  time: z.number()       // Unix timestamp
}).meta({ ref: "RealtimeEventPart" })

export type RealtimeEventPart = z.infer<typeof RealtimeEventPart>
```

**Purpose**: Track conversation dynamics for debugging and analytics.

### ToolStateInterrupted

New variant for the ToolState discriminated union.

```typescript
export const ToolStateInterrupted = z.object({
  status: z.literal("interrupted"),
  input: z.record(z.string(), z.any()),
  reason: z.enum([
    "user_speech",      // User started speaking during execution
    "response_cancel",  // Explicit cancellation
    "connection_lost"   // WebSocket disconnected
  ]),
  partialOutput: z.string().optional(),  // If tool produced partial results
  time: z.object({
    start: z.number(),
    end: z.number(),
  }),
}).meta({ ref: "ToolStateInterrupted" })

// Updated ToolState union
export const ToolState = z.discriminatedUnion("status", [
  ToolStatePending,
  ToolStateRunning,
  ToolStateCompleted,
  ToolStateError,
  ToolStateInterrupted,  // NEW
])
```

---

## Protocol Types

### Client → Server Messages

```typescript
// src/realtime/protocol.ts

export const AudioChunkMessage = z.object({
  type: z.literal("audio.chunk"),
  data: z.string(),  // base64 encoded
  encoding: z.enum(["pcm16", "g711_ulaw", "g711_alaw"])
})

export const AudioCommitMessage = z.object({
  type: z.literal("audio.commit")
})

export const InputCancelMessage = z.object({
  type: z.literal("input.cancel")
})

export const ResponseCancelMessage = z.object({
  type: z.literal("response.cancel")
})

export const SessionUpdateMessage = z.object({
  type: z.literal("session.update"),
  config: RealtimeSessionConfig.partial()
})

export const ClientMessage = z.discriminatedUnion("type", [
  AudioChunkMessage,
  AudioCommitMessage,
  InputCancelMessage,
  ResponseCancelMessage,
  SessionUpdateMessage,
])

export type ClientMessage = z.infer<typeof ClientMessage>
```

### Server → Client Messages

```typescript
export const SessionCreatedMessage = z.object({
  type: z.literal("session.created"),
  session: RealtimeSession
})

export const SessionUpdatedMessage = z.object({
  type: z.literal("session.updated"),
  session: RealtimeSession
})

export const AudioChunkServerMessage = z.object({
  type: z.literal("audio.chunk"),
  data: z.string(),
  encoding: z.string()
})

export const AudioDoneMessage = z.object({
  type: z.literal("audio.done")
})

export const TranscriptMessage = z.object({
  type: z.enum(["transcript.partial", "transcript.final"]),
  text: z.string(),
  role: z.enum(["user", "assistant"])
})

export const VADMessage = z.object({
  type: z.enum(["vad.speech_started", "vad.speech_stopped"])
})

export const ResponseMessage = z.object({
  type: z.enum(["response.started", "response.done"]),
  usage: TokenUsage.optional()
})

export const ToolCallMessage = z.object({
  type: z.literal("tool.call"),
  callId: z.string(),
  name: z.string(),
  args: z.unknown()
})

export const ErrorMessage = z.object({
  type: z.literal("error"),
  code: z.string(),
  message: z.string()
})

export const ServerMessage = z.discriminatedUnion("type", [
  SessionCreatedMessage,
  SessionUpdatedMessage,
  AudioChunkServerMessage,
  AudioDoneMessage,
  TranscriptMessage,
  VADMessage,
  ResponseMessage,
  ToolCallMessage,
  ErrorMessage,
])

export type ServerMessage = z.infer<typeof ServerMessage>
```

---

## Configuration Types

### RealtimeConfig

```typescript
export const RealtimeConfig = z.object({
  model: z.string(),
  voice: z.enum(["alloy", "echo", "shimmer", "ash", "ballad", "coral", "sage", "verse"]),
  instructions: z.string(),
  tools: z.array(ToolDefinition).optional(),
  inputAudioTranscription: z.object({
    model: z.string()
  }).nullable().optional(),
  turnDetection: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("server_vad"),
      threshold: z.number().min(0).max(1).default(0.5),
      prefixPaddingMs: z.number().default(300),
      silenceDurationMs: z.number().default(500),
      createResponse: z.boolean().default(true)
    }),
    z.object({
      type: z.literal("none")  // Manual/push-to-talk mode
    })
  ]).optional(),
  temperature: z.number().min(0).max(2).default(0.8),
  maxResponseTokens: z.union([z.number(), z.literal("inf")]).default("inf")
})

export type RealtimeConfig = z.infer<typeof RealtimeConfig>
```

### RealtimeSession

```typescript
export const RealtimeSession = z.object({
  id: z.string(),
  model: z.string(),
  voice: z.string(),
  instructions: z.string(),
  tools: z.array(ToolDefinition),
  turnDetection: z.object({
    type: z.string(),
    threshold: z.number().optional(),
    silenceDurationMs: z.number().optional()
  }),
  inputAudioFormat: z.string(),
  outputAudioFormat: z.string()
})

export type RealtimeSession = z.infer<typeof RealtimeSession>
```

---

## Transport Types

### RealtimeTransport Interface

```typescript
// src/realtime/transport.ts

export interface AudioChunk {
  data: string      // base64 encoded
  encoding: "pcm16" | "g711_ulaw" | "g711_alaw"
}

export interface VADEvent {
  type: "speech_started" | "speech_stopped"
  audioStartMs?: number
  audioEndMs?: number
}

export interface ToolCall {
  callId: string
  name: string
  args: unknown
}

export interface RealtimeTransport {
  // Lifecycle
  connect(config: RealtimeConfig): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean

  // Audio I/O
  sendAudio(chunk: AudioChunk): void
  onAudio(handler: (chunk: AudioChunk) => void): () => void

  // Events
  onTranscript(handler: (text: string, role: "user" | "assistant", final: boolean) => void): () => void
  onVAD(handler: (event: VADEvent) => void): () => void
  onToolCall(handler: (call: ToolCall) => void): () => void
  onError(handler: (error: RealtimeError) => void): () => void

  // Control
  respondToTool(callId: string, result: unknown): void
  respondToToolError(callId: string, error: string): void
  interrupt(): void
  updateSession(config: Partial<RealtimeConfig>): void
}
```

---

## Event Types

### Bus Events

```typescript
// src/realtime/events.ts

export const RealtimeEvent = {
  Connected: BusEvent.define("realtime.connected", z.object({
    sessionID: z.string()
  })),

  Disconnected: BusEvent.define("realtime.disconnected", z.object({
    sessionID: z.string(),
    reason: z.string().optional()
  })),

  SpeechStarted: BusEvent.define("realtime.speech_started", z.object({
    sessionID: z.string()
  })),

  SpeechStopped: BusEvent.define("realtime.speech_stopped", z.object({
    sessionID: z.string()
  })),

  Transcript: BusEvent.define("realtime.transcript", z.object({
    sessionID: z.string(),
    text: z.string(),
    role: z.enum(["user", "assistant"]),
    final: z.boolean()
  })),

  AudioChunk: BusEvent.define("realtime.audio_chunk", z.object({
    sessionID: z.string(),
    data: z.string(),
    encoding: z.string()
  })),

  ResponseStarted: BusEvent.define("realtime.response_started", z.object({
    sessionID: z.string()
  })),

  ResponseDone: BusEvent.define("realtime.response_done", z.object({
    sessionID: z.string(),
    usage: TokenUsage.optional()
  })),

  Error: BusEvent.define("realtime.error", z.object({
    sessionID: z.string(),
    code: z.string(),
    message: z.string()
  }))
}
```

---

## Error Types

```typescript
// src/realtime/errors.ts

export class RealtimeError extends Error {
  name = "RealtimeError"
  constructor(message: string, public code?: string) {
    super(message)
  }
}

export class RealtimeConnectionError extends RealtimeError {
  name = "RealtimeConnectionError"
  retryable = true

  constructor(message: string, public readonly socketCode?: string) {
    super(message, "CONNECTION_ERROR")
  }
}

export class RealtimeAuthError extends RealtimeError {
  name = "RealtimeAuthError"
  retryable = false

  constructor(message: string) {
    super(message, "AUTH_ERROR")
  }
}

export class RealtimeTimeoutError extends RealtimeError {
  name = "RealtimeTimeoutError"
  retryable = true

  constructor(message: string) {
    super(message, "TIMEOUT")
  }
}

export class RealtimeProtocolError extends RealtimeError {
  name = "RealtimeProtocolError"
  retryable = false

  constructor(message: string, public readonly event?: unknown) {
    super(message, "PROTOCOL_ERROR")
  }
}
```

---

## Audio Utility Types

```typescript
// src/util/audio.ts

export interface PCM16Options {
  sampleRate: number  // e.g., 24000
  channels: number    // 1 for mono
}

export interface AudioEncoderResult {
  data: Int16Array
  sampleRate: number
  channels: number
}

// Conversion functions
export function float32ToPcm16(float32: Float32Array): Int16Array
export function pcm16ToFloat32(pcm16: Int16Array): Float32Array
export function encodeBase64(pcm16: Int16Array): string
export function decodeBase64(base64: string): Int16Array
```
