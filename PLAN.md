# OpenAI Realtime API Integration Plan

## Executive Summary

This document outlines the plan for adding OpenAI Realtime API support to opencode, enabling true conversational voice interactions. Unlike traditional TTS/STT workflows, the Realtime API provides native bidirectional audio streaming with server-side Voice Activity Detection (VAD), enabling natural, interruptible conversations.

## Goals

1. **True Realtime Voice**: Native audio streaming, not TTS/STT wrapper
2. **Natural Conversations**: Server-side VAD for pause detection and interruption handling
3. **Full Compatibility**: Integrate seamlessly with existing opencode architecture
4. **Extensibility**: Design for future realtime providers (e.g., Gemini Live)

## Current Architecture Analysis

### What Already Exists

| Component | Status | Notes |
|-----------|--------|-------|
| WebSocket Infrastructure | ✅ Available | `hono/bun` websocket imported but unused |
| Provider System | ✅ Extensible | Custom loaders, model metadata, modality support |
| Audio Modality Detection | ✅ Partial | `mimeToModality()` handles audio MIME types |
| Streaming Infrastructure | ✅ Working | SSE for events, HTTP streaming for responses |
| Message Parts System | ⚠️ Needs Extension | No `AudioPart` or `VADEventPart` types |
| Session System | ✅ Compatible | Can accommodate audio I/O |

### What Needs to Be Built

1. **WebSocket Transport Layer** - Bidirectional audio streaming
2. **Realtime Provider Abstraction** - OpenAI Realtime protocol mapping
3. **Audio Message Parts** - New part types for audio data
4. **Client Audio Handling** - Capture, playback, WebSocket client
5. **VAD Integration** - Handle interruptions and turn-taking
6. **TUI/Desktop Audio UI** - Indicators, controls, settings

---

## Technical Design

### 1. WebSocket Transport Architecture

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
                       │ WebSocket (wss://localhost:4096/session/:id/realtime)
                       │
┌──────────────────────┼───────────────────────────────────────────────┐
│ OpenCode Server      │                                               │
│  ┌───────────────────▼────────────────────────────────────────────┐  │
│  │ RealtimeRouter (/session/:sessionID/realtime)                  │  │
│  │ - WebSocket upgrade handling                                   │  │
│  │ - Client <-> Provider message routing                          │  │
│  │ - Session state management                                     │  │
│  └───────────────────┬────────────────────────────────────────────┘  │
│                      │                                               │
│  ┌───────────────────▼────────────────────────────────────────────┐  │
│  │ RealtimeTransport (src/provider/realtime/)                     │  │
│  │ - Provider-agnostic realtime abstraction                       │  │
│  │ - Event normalization                                          │  │
│  │ - Connection lifecycle management                              │  │
│  └───────────────────┬────────────────────────────────────────────┘  │
│                      │                                               │
│  ┌───────────────────▼────────────────────────────────────────────┐  │
│  │ OpenAIRealtimeProvider (src/provider/realtime/openai.ts)       │  │
│  │ - OpenAI Realtime API protocol                                 │  │
│  │ - WebSocket to wss://api.openai.com/v1/realtime                │  │
│  │ - Model: gpt-4o-realtime-preview                               │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### 2. Message Protocol Design

#### 2.1 Client ↔ Server Messages

```typescript
// src/realtime/protocol.ts

// Client → Server
type ClientRealtimeMessage =
  | { type: "audio.chunk"; data: string; encoding: "pcm16" | "g711_ulaw" | "g711_alaw" }
  | { type: "audio.commit" }  // Commit buffered audio (manual VAD mode)
  | { type: "input.cancel" }  // Cancel current user input
  | { type: "response.cancel" }  // Interrupt assistant response
  | { type: "session.update"; config: RealtimeSessionConfig }
  | { type: "tool.result"; callId: string; result: unknown }

// Server → Client
type ServerRealtimeMessage =
  | { type: "session.created"; session: RealtimeSession }
  | { type: "session.updated"; session: RealtimeSession }
  | { type: "audio.chunk"; data: string; encoding: string }
  | { type: "audio.done" }
  | { type: "transcript.partial"; text: string; role: "user" | "assistant" }
  | { type: "transcript.final"; text: string; role: "user" | "assistant" }
  | { type: "vad.speech_started" }
  | { type: "vad.speech_stopped" }
  | { type: "response.started" }
  | { type: "response.done"; usage: TokenUsage }
  | { type: "tool.call"; callId: string; name: string; args: unknown }
  | { type: "error"; code: string; message: string }
```

#### 2.2 New Message Parts

```typescript
// src/session/message-v2.ts - Extensions

type AudioPart = {
  type: "audio"
  transcript?: string        // STT transcript when available
  duration?: number          // Duration in milliseconds
  url?: string              // URL to audio file (for persistence)
  encoding?: "pcm16" | "mp3" | "opus"
}

type RealtimeEventPart = {
  type: "realtime-event"
  event: "speech_started" | "speech_stopped" | "interrupted" | "response_started"
  time: number
}
```

### 3. Provider Abstraction

```typescript
// src/provider/realtime/transport.ts

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

interface RealtimeConfig {
  model: string
  voice: "alloy" | "echo" | "shimmer" | "ash" | "ballad" | "coral" | "sage" | "verse"
  instructions: string
  tools: ToolDefinition[]
  inputAudioTranscription: { model: string } | null
  turnDetection: {
    type: "server_vad"
    threshold: number          // 0.0-1.0, default 0.5
    prefixPaddingMs: number    // default 300
    silenceDurationMs: number  // default 500
    createResponse: boolean    // auto-respond on speech end
  } | { type: "none" }  // Manual mode
  temperature: number
  maxResponseTokens: number | "inf"
}
```

### 4. OpenAI Realtime Implementation

```typescript
// src/provider/realtime/openai.ts

export class OpenAIRealtimeTransport implements RealtimeTransport {
  private ws: WebSocket | null = null
  private eventHandlers: Map<string, Function[]> = new Map()

  async connect(config: RealtimeConfig): Promise<void> {
    const url = `wss://api.openai.com/v1/realtime?model=${config.model}`

    this.ws = new WebSocket(url, {
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "OpenAI-Beta": "realtime=v1"
      }
    })

    this.ws.onmessage = (event) => this.handleMessage(JSON.parse(event.data))

    // Send session configuration after connection
    await this.waitForOpen()
    this.send({
      type: "session.update",
      session: this.mapConfig(config)
    })
  }

  private handleMessage(msg: OpenAIRealtimeEvent) {
    // Map OpenAI events to our normalized protocol
    switch (msg.type) {
      case "response.audio.delta":
        this.emit("audio", { data: msg.delta, encoding: "pcm16" })
        break
      case "conversation.item.input_audio_transcription.completed":
        this.emit("transcript", msg.transcript, "user", true)
        break
      case "response.audio_transcript.delta":
        this.emit("transcript", msg.delta, "assistant", false)
        break
      case "input_audio_buffer.speech_started":
        this.emit("vad", { type: "speech_started" })
        break
      case "input_audio_buffer.speech_stopped":
        this.emit("vad", { type: "speech_stopped" })
        break
      case "response.function_call_arguments.done":
        this.emit("tool_call", {
          callId: msg.call_id,
          name: msg.name,
          args: JSON.parse(msg.arguments)
        })
        break
      // ... handle other events
    }
  }

  sendAudio(chunk: AudioChunk): void {
    this.send({
      type: "input_audio_buffer.append",
      audio: chunk.data  // base64 encoded PCM16
    })
  }

  interrupt(): void {
    this.send({ type: "response.cancel" })
  }
}
```

### 5. Server WebSocket Route

```typescript
// src/server/routes/realtime.ts

import { Hono } from "hono"
import { websocket } from "hono/bun"

export const RealtimeRoutes = new Hono()
  .get(
    "/:sessionID/realtime",
    websocket({
      onOpen(ws, c) {
        const sessionID = c.req.param("sessionID")
        const session = Session.get(sessionID)

        // Initialize realtime transport for this session
        const transport = RealtimeTransportFactory.create(
          session.model.providerID,
          session.model.modelID
        )

        // Store transport in connection context
        ws.data = { sessionID, transport }

        // Setup bidirectional event forwarding
        transport.onAudio((chunk) => ws.send(JSON.stringify({
          type: "audio.chunk",
          ...chunk
        })))

        transport.onTranscript((text, role, final) => {
          ws.send(JSON.stringify({
            type: final ? "transcript.final" : "transcript.partial",
            text,
            role
          }))

          // Persist final transcripts to session
          if (final) {
            SessionMessage.addPart(sessionID, {
              type: "audio",
              transcript: text
            })
          }
        })

        transport.onVAD((event) => ws.send(JSON.stringify({
          type: `vad.${event.type}`
        })))

        transport.onToolCall(async (call) => {
          ws.send(JSON.stringify({ type: "tool.call", ...call }))
          // Tool execution handled by existing tool system
          const result = await Tool.execute(call.name, call.args, session)
          transport.respondToTool(call.callId, result)
        })

        // Connect to provider
        transport.connect({
          model: session.model.modelID,
          voice: session.config.voice || "alloy",
          instructions: session.systemPrompt,
          tools: session.enabledTools,
          turnDetection: { type: "server_vad", ...defaults },
          ...session.config.realtime
        })
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
          case "tool.result":
            transport.respondToTool(msg.callId, msg.result)
            break
        }
      },

      onClose(ws) {
        ws.data.transport?.disconnect()
      }
    })
  )
```

### 6. Client Implementation

#### 6.1 Web/Desktop Audio Capture

```typescript
// packages/app/src/realtime/audio-capture.ts

export class AudioCapture {
  private context: AudioContext
  private processor: AudioWorkletNode
  private stream: MediaStream

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 24000,  // OpenAI Realtime requires 24kHz
        echoCancellation: true,
        noiseSuppression: true
      }
    })

    this.context = new AudioContext({ sampleRate: 24000 })
    await this.context.audioWorklet.addModule("/audio-processor.js")

    const source = this.context.createMediaStreamSource(this.stream)
    this.processor = new AudioWorkletNode(this.context, "pcm-processor")

    this.processor.port.onmessage = (e) => {
      // e.data contains Float32Array, convert to PCM16 base64
      const pcm16 = float32ToPcm16(e.data)
      const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)))
      this.onChunk?.(base64)
    }

    source.connect(this.processor)
  }

  stop(): void {
    this.stream?.getTracks().forEach(t => t.stop())
    this.context?.close()
  }

  onChunk?: (base64: string) => void
}
```

#### 6.2 TUI Audio (via Native Module)

```typescript
// src/cli/cmd/tui/audio/capture.ts

// For TUI, we need native audio access
// Options:
// 1. Use Bun FFI to bind to platform audio APIs
// 2. Spawn external process (sox, ffmpeg) for capture
// 3. Use node-microphone or similar native module

import { spawn } from "bun"

export class TUIAudioCapture {
  private process: Subprocess | null = null

  async start(): Promise<void> {
    // Use sox for cross-platform audio capture
    // Outputs raw 24kHz mono PCM16
    this.process = spawn([
      "sox",
      "-d",                    // Default audio input device
      "-t", "raw",             // Raw output format
      "-r", "24000",           // 24kHz sample rate
      "-c", "1",               // Mono
      "-b", "16",              // 16-bit
      "-e", "signed-integer",  // Signed PCM
      "-"                      // Output to stdout
    ], {
      stdout: "pipe"
    })

    // Read chunks from stdout
    const reader = this.process.stdout.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      this.onChunk?.(Buffer.from(value).toString("base64"))
    }
  }

  stop(): void {
    this.process?.kill()
  }

  onChunk?: (base64: string) => void
}
```

#### 6.3 WebSocket Client

```typescript
// packages/sdk/js/src/realtime.ts

export class RealtimeClient {
  private ws: WebSocket
  private audioCapture: AudioCapture
  private audioPlayback: AudioPlayback

  constructor(private baseUrl: string, private sessionId: string) {}

  async connect(): Promise<void> {
    const wsUrl = this.baseUrl.replace("http", "ws")
    this.ws = new WebSocket(`${wsUrl}/session/${this.sessionId}/realtime`)

    this.ws.onmessage = (e) => this.handleMessage(JSON.parse(e.data))

    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve
      this.ws.onerror = reject
    })

    // Start audio capture
    this.audioCapture = new AudioCapture()
    this.audioCapture.onChunk = (data) => {
      this.ws.send(JSON.stringify({ type: "audio.chunk", data, encoding: "pcm16" }))
    }
    await this.audioCapture.start()

    // Setup audio playback
    this.audioPlayback = new AudioPlayback()
    await this.audioPlayback.init()
  }

  private handleMessage(msg: ServerRealtimeMessage) {
    switch (msg.type) {
      case "audio.chunk":
        this.audioPlayback.enqueue(msg.data)
        break
      case "vad.speech_started":
        this.onSpeechStart?.()
        break
      case "vad.speech_stopped":
        this.onSpeechEnd?.()
        break
      case "transcript.final":
        this.onTranscript?.(msg.text, msg.role)
        break
      case "response.started":
        this.onResponseStart?.()
        break
      case "response.done":
        this.onResponseEnd?.(msg.usage)
        break
    }
  }

  interrupt(): void {
    this.ws.send(JSON.stringify({ type: "response.cancel" }))
    this.audioPlayback.clear()
  }

  disconnect(): void {
    this.audioCapture.stop()
    this.ws.close()
  }

  // Event callbacks
  onSpeechStart?: () => void
  onSpeechEnd?: () => void
  onTranscript?: (text: string, role: "user" | "assistant") => void
  onResponseStart?: () => void
  onResponseEnd?: (usage: TokenUsage) => void
}
```

---

## Implementation Phases (TDD Approach)

Each task follows Test-Driven Development: write the test first, then implement.

### Phase 1: Protocol & Types Foundation

**Goal**: Define all types, schemas, and protocol messages before implementation.

#### 1.1 Audio Encoding Utilities

| # | Task | File | Description |
|---|------|------|-------------|
| 1.1.1 | **TEST**: Audio encoding utilities | `test/util/audio.test.ts` | Test float32ToPcm16, pcm16ToFloat32, base64 encode/decode |
| 1.1.2 | **IMPL**: Audio encoding utilities | `src/util/audio.ts` | Pure functions for PCM16 ↔ Float32 ↔ base64 conversion |

```typescript
// test/util/audio.test.ts
import { describe, expect, test } from "bun:test"
import { float32ToPcm16, pcm16ToFloat32, encodeBase64, decodeBase64 } from "../../src/util/audio"

describe("audio encoding", () => {
  test("float32ToPcm16 converts correctly", () => {
    const float32 = new Float32Array([0, 0.5, -0.5, 1, -1])
    const pcm16 = float32ToPcm16(float32)
    expect(pcm16).toBeInstanceOf(Int16Array)
    expect(pcm16[0]).toBe(0)
    expect(pcm16[1]).toBeCloseTo(16383, -2)  // 0.5 * 32767
    expect(pcm16[2]).toBeCloseTo(-16384, -2)
  })

  test("pcm16ToFloat32 converts correctly", () => {
    const pcm16 = new Int16Array([0, 16384, -16384, 32767, -32768])
    const float32 = pcm16ToFloat32(pcm16)
    expect(float32[0]).toBeCloseTo(0)
    expect(float32[1]).toBeCloseTo(0.5, 1)
  })

  test("roundtrip preserves data", () => {
    const original = new Float32Array([0.1, -0.3, 0.7])
    const roundtrip = pcm16ToFloat32(float32ToPcm16(original))
    for (let i = 0; i < original.length; i++) {
      expect(roundtrip[i]).toBeCloseTo(original[i], 2)
    }
  })

  test("base64 encode/decode roundtrip", () => {
    const pcm16 = new Int16Array([100, 200, -300])
    const base64 = encodeBase64(pcm16)
    expect(typeof base64).toBe("string")
    const decoded = decodeBase64(base64)
    expect(decoded).toEqual(pcm16)
  })
})
```

---

#### 1.2 Realtime Protocol Types

| # | Task | File | Description |
|---|------|------|-------------|
| 1.2.1 | **TEST**: Protocol message schemas | `test/realtime/protocol.test.ts` | Test Zod schema validation for all message types |
| 1.2.2 | **IMPL**: Protocol message schemas | `src/realtime/protocol.ts` | Zod schemas for client↔server messages |

```typescript
// test/realtime/protocol.test.ts
import { describe, expect, test } from "bun:test"
import { ClientMessage, ServerMessage, RealtimeConfig } from "../../src/realtime/protocol"

describe("realtime protocol", () => {
  describe("ClientMessage", () => {
    test("validates audio.chunk", () => {
      const msg = { type: "audio.chunk", data: "base64data", encoding: "pcm16" }
      expect(ClientMessage.safeParse(msg).success).toBe(true)
    })

    test("rejects invalid encoding", () => {
      const msg = { type: "audio.chunk", data: "base64data", encoding: "mp3" }
      expect(ClientMessage.safeParse(msg).success).toBe(false)
    })

    test("validates response.cancel", () => {
      expect(ClientMessage.safeParse({ type: "response.cancel" }).success).toBe(true)
    })

    test("validates session.update", () => {
      const msg = { type: "session.update", config: { voice: "alloy" } }
      expect(ClientMessage.safeParse(msg).success).toBe(true)
    })
  })

  describe("ServerMessage", () => {
    test("validates audio.chunk", () => {
      const msg = { type: "audio.chunk", data: "base64", encoding: "pcm16" }
      expect(ServerMessage.safeParse(msg).success).toBe(true)
    })

    test("validates transcript.final", () => {
      const msg = { type: "transcript.final", text: "hello", role: "user" }
      expect(ServerMessage.safeParse(msg).success).toBe(true)
    })

    test("validates vad events", () => {
      expect(ServerMessage.safeParse({ type: "vad.speech_started" }).success).toBe(true)
      expect(ServerMessage.safeParse({ type: "vad.speech_stopped" }).success).toBe(true)
    })
  })

  describe("RealtimeConfig", () => {
    test("validates full config", () => {
      const config = {
        model: "gpt-4o-realtime-preview",
        voice: "alloy",
        instructions: "You are helpful",
        turnDetection: { type: "server_vad", threshold: 0.5 }
      }
      expect(RealtimeConfig.safeParse(config).success).toBe(true)
    })

    test("validates voice enum", () => {
      const validVoices = ["alloy", "echo", "shimmer", "ash", "ballad", "coral", "sage", "verse"]
      for (const voice of validVoices) {
        expect(RealtimeConfig.safeParse({ voice }).success).toBe(true)
      }
    })
  })
})
```

---

#### 1.3 AudioPart Message Type

| # | Task | File | Description |
|---|------|------|-------------|
| 1.3.1 | **TEST**: AudioPart schema validation | `test/session/audio-part.test.ts` | Test AudioPart Zod schema and serialization |
| 1.3.2 | **IMPL**: AudioPart schema | `src/session/message-v2.ts` | Add AudioPart to Part discriminated union |

```typescript
// test/session/audio-part.test.ts
import { describe, expect, test } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"

describe("MessageV2.AudioPart", () => {
  test("validates minimal audio part", () => {
    const part = {
      id: "part-1",
      sessionID: "sess-1",
      messageID: "msg-1",
      type: "audio",
      transcript: "Hello world"
    }
    const result = MessageV2.Part.safeParse(part)
    expect(result.success).toBe(true)
    expect(result.data?.type).toBe("audio")
  })

  test("validates full audio part", () => {
    const part = {
      id: "part-1",
      sessionID: "sess-1",
      messageID: "msg-1",
      type: "audio",
      transcript: "Hello world",
      duration: 2500,
      url: "file:///audio/recording.wav",
      encoding: "pcm16"
    }
    expect(MessageV2.Part.safeParse(part).success).toBe(true)
  })

  test("rejects invalid encoding", () => {
    const part = {
      id: "part-1",
      sessionID: "sess-1",
      messageID: "msg-1",
      type: "audio",
      encoding: "invalid"
    }
    expect(MessageV2.Part.safeParse(part).success).toBe(false)
  })

  test("AudioPart is included in Part union", () => {
    const types = MessageV2.Part.options.map(s => s.shape.type._def.value)
    expect(types).toContain("audio")
  })
})
```

---

#### 1.4 RealtimeEventPart Message Type

| # | Task | File | Description |
|---|------|------|-------------|
| 1.4.1 | **TEST**: RealtimeEventPart schema | `test/session/realtime-event-part.test.ts` | Test RealtimeEventPart validation |
| 1.4.2 | **IMPL**: RealtimeEventPart schema | `src/session/message-v2.ts` | Add RealtimeEventPart to Part union |

```typescript
// test/session/realtime-event-part.test.ts
import { describe, expect, test } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"

describe("MessageV2.RealtimeEventPart", () => {
  test("validates speech_started event", () => {
    const part = {
      id: "part-1",
      sessionID: "sess-1",
      messageID: "msg-1",
      type: "realtime-event",
      event: "speech_started",
      time: Date.now()
    }
    expect(MessageV2.Part.safeParse(part).success).toBe(true)
  })

  test("validates all event types", () => {
    const events = ["speech_started", "speech_stopped", "interrupted", "response_started"]
    for (const event of events) {
      const part = {
        id: "p-1", sessionID: "s-1", messageID: "m-1",
        type: "realtime-event", event, time: 0
      }
      expect(MessageV2.Part.safeParse(part).success).toBe(true)
    }
  })

  test("rejects invalid event type", () => {
    const part = {
      id: "p-1", sessionID: "s-1", messageID: "m-1",
      type: "realtime-event", event: "invalid_event", time: 0
    }
    expect(MessageV2.Part.safeParse(part).success).toBe(false)
  })
})
```

---

#### 1.5 OpenAI Realtime Event Types

| # | Task | File | Description |
|---|------|------|-------------|
| 1.5.1 | **TEST**: OpenAI event type mapping | `test/realtime/openai-events.test.ts` | Test OpenAI event schema validation |
| 1.5.2 | **IMPL**: OpenAI event types | `src/realtime/openai-events.ts` | Zod schemas for OpenAI Realtime API events |

```typescript
// test/realtime/openai-events.test.ts
import { describe, expect, test } from "bun:test"
import {
  OpenAIClientEvent,
  OpenAIServerEvent,
  parseOpenAIEvent
} from "../../src/realtime/openai-events"

describe("OpenAI Realtime Events", () => {
  describe("client events", () => {
    test("validates session.update", () => {
      const event = {
        type: "session.update",
        session: { modalities: ["text", "audio"], voice: "alloy" }
      }
      expect(OpenAIClientEvent.safeParse(event).success).toBe(true)
    })

    test("validates input_audio_buffer.append", () => {
      const event = { type: "input_audio_buffer.append", audio: "base64data" }
      expect(OpenAIClientEvent.safeParse(event).success).toBe(true)
    })

    test("validates response.cancel", () => {
      expect(OpenAIClientEvent.safeParse({ type: "response.cancel" }).success).toBe(true)
    })
  })

  describe("server events", () => {
    test("validates response.audio.delta", () => {
      const event = {
        type: "response.audio.delta",
        response_id: "resp-1",
        item_id: "item-1",
        output_index: 0,
        content_index: 0,
        delta: "base64audio"
      }
      expect(OpenAIServerEvent.safeParse(event).success).toBe(true)
    })

    test("validates input_audio_buffer.speech_started", () => {
      const event = {
        type: "input_audio_buffer.speech_started",
        audio_start_ms: 1500,
        item_id: "item-1"
      }
      expect(OpenAIServerEvent.safeParse(event).success).toBe(true)
    })
  })

  describe("parseOpenAIEvent", () => {
    test("parses JSON string to typed event", () => {
      const json = JSON.stringify({ type: "response.audio.done" })
      const event = parseOpenAIEvent(json)
      expect(event.type).toBe("response.audio.done")
    })
  })
})
```

---

### Phase 2: Transport Layer

**Goal**: Implement the provider-agnostic transport interface and OpenAI implementation.

#### 2.1 Transport Interface

| # | Task | File | Description |
|---|------|------|-------------|
| 2.1.1 | **TEST**: Transport interface contract | `test/realtime/transport.test.ts` | Test mock transport behavior |
| 2.1.2 | **IMPL**: Transport interface | `src/realtime/transport.ts` | Define RealtimeTransport interface and types |

```typescript
// test/realtime/transport.test.ts
import { describe, expect, test, mock } from "bun:test"
import type { RealtimeTransport, RealtimeConfig } from "../../src/realtime/transport"
import { createMockTransport } from "../../src/realtime/transport"

describe("RealtimeTransport interface", () => {
  test("mock transport implements all methods", () => {
    const transport = createMockTransport()
    expect(typeof transport.connect).toBe("function")
    expect(typeof transport.disconnect).toBe("function")
    expect(typeof transport.sendAudio).toBe("function")
    expect(typeof transport.onAudio).toBe("function")
    expect(typeof transport.onTranscript).toBe("function")
    expect(typeof transport.onVAD).toBe("function")
    expect(typeof transport.onToolCall).toBe("function")
    expect(typeof transport.respondToTool).toBe("function")
    expect(typeof transport.interrupt).toBe("function")
    expect(typeof transport.updateSession).toBe("function")
  })

  test("mock transport tracks connection state", async () => {
    const transport = createMockTransport()
    expect(transport.isConnected()).toBe(false)
    await transport.connect({ model: "test", voice: "alloy" } as RealtimeConfig)
    expect(transport.isConnected()).toBe(true)
    await transport.disconnect()
    expect(transport.isConnected()).toBe(false)
  })

  test("mock transport emits events to handlers", async () => {
    const transport = createMockTransport()
    const audioHandler = mock(() => {})
    transport.onAudio(audioHandler)

    await transport.connect({ model: "test" } as RealtimeConfig)
    transport._simulateAudio({ data: "test", encoding: "pcm16" })

    expect(audioHandler).toHaveBeenCalledTimes(1)
  })
})
```

---

#### 2.2 Event Emitter for Transport

| # | Task | File | Description |
|---|------|------|-------------|
| 2.2.1 | **TEST**: Typed event emitter | `test/realtime/emitter.test.ts` | Test type-safe event subscription/emission |
| 2.2.2 | **IMPL**: Typed event emitter | `src/realtime/emitter.ts` | Generic typed event emitter class |

```typescript
// test/realtime/emitter.test.ts
import { describe, expect, test, mock } from "bun:test"
import { TypedEmitter } from "../../src/realtime/emitter"

type TestEvents = {
  audio: { data: string }
  transcript: { text: string; final: boolean }
  error: { message: string }
}

describe("TypedEmitter", () => {
  test("emits events to subscribers", () => {
    const emitter = new TypedEmitter<TestEvents>()
    const handler = mock(() => {})
    emitter.on("audio", handler)
    emitter.emit("audio", { data: "test" })
    expect(handler).toHaveBeenCalledWith({ data: "test" })
  })

  test("supports multiple subscribers", () => {
    const emitter = new TypedEmitter<TestEvents>()
    const h1 = mock(() => {})
    const h2 = mock(() => {})
    emitter.on("transcript", h1)
    emitter.on("transcript", h2)
    emitter.emit("transcript", { text: "hello", final: true })
    expect(h1).toHaveBeenCalledTimes(1)
    expect(h2).toHaveBeenCalledTimes(1)
  })

  test("off removes subscriber", () => {
    const emitter = new TypedEmitter<TestEvents>()
    const handler = mock(() => {})
    emitter.on("error", handler)
    emitter.off("error", handler)
    emitter.emit("error", { message: "fail" })
    expect(handler).not.toHaveBeenCalled()
  })

  test("once fires only once", () => {
    const emitter = new TypedEmitter<TestEvents>()
    const handler = mock(() => {})
    emitter.once("audio", handler)
    emitter.emit("audio", { data: "1" })
    emitter.emit("audio", { data: "2" })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  test("removeAllListeners clears all", () => {
    const emitter = new TypedEmitter<TestEvents>()
    emitter.on("audio", () => {})
    emitter.on("transcript", () => {})
    emitter.removeAllListeners()
    expect(emitter.listenerCount("audio")).toBe(0)
    expect(emitter.listenerCount("transcript")).toBe(0)
  })
})
```

---

#### 2.3 OpenAI Transport - Connection

| # | Task | File | Description |
|---|------|------|-------------|
| 2.3.1 | **TEST**: OpenAI transport connection | `test/realtime/openai-transport-connect.test.ts` | Test WebSocket connection lifecycle |
| 2.3.2 | **IMPL**: OpenAI transport base | `src/realtime/openai-transport.ts` | WebSocket connection and basic setup |

```typescript
// test/realtime/openai-transport-connect.test.ts
import { describe, expect, test, mock, beforeEach } from "bun:test"

// Mock WebSocket before import
const mockWs = {
  send: mock(() => {}),
  close: mock(() => {}),
  readyState: 1,
  onopen: null as Function | null,
  onmessage: null as Function | null,
  onclose: null as Function | null,
  onerror: null as Function | null,
}

mock.module("ws", () => ({
  WebSocket: class MockWebSocket {
    constructor(public url: string, public options: any) {
      Object.assign(this, mockWs)
      setTimeout(() => this.onopen?.(), 0)
    }
  }
}))

const { OpenAIRealtimeTransport } = await import("../../src/realtime/openai-transport")

describe("OpenAIRealtimeTransport connection", () => {
  beforeEach(() => {
    mockWs.send.mockClear()
    mockWs.close.mockClear()
  })

  test("connects to correct URL with model param", async () => {
    const transport = new OpenAIRealtimeTransport({ apiKey: "test-key" })
    await transport.connect({
      model: "gpt-4o-realtime-preview",
      voice: "alloy",
      instructions: ""
    })
    expect(transport["ws"]?.url).toContain("wss://api.openai.com/v1/realtime")
    expect(transport["ws"]?.url).toContain("model=gpt-4o-realtime-preview")
  })

  test("sends session.update after connection", async () => {
    const transport = new OpenAIRealtimeTransport({ apiKey: "test-key" })
    await transport.connect({
      model: "gpt-4o-realtime-preview",
      voice: "echo",
      instructions: "Be helpful"
    })

    expect(mockWs.send).toHaveBeenCalled()
    const sentData = JSON.parse(mockWs.send.mock.calls[0][0])
    expect(sentData.type).toBe("session.update")
    expect(sentData.session.voice).toBe("echo")
  })

  test("disconnect closes WebSocket", async () => {
    const transport = new OpenAIRealtimeTransport({ apiKey: "test-key" })
    await transport.connect({ model: "test", voice: "alloy", instructions: "" })
    await transport.disconnect()
    expect(mockWs.close).toHaveBeenCalled()
  })

  test("includes auth header", async () => {
    const transport = new OpenAIRealtimeTransport({ apiKey: "sk-test123" })
    await transport.connect({ model: "test", voice: "alloy", instructions: "" })
    expect(transport["ws"]?.options.headers["Authorization"]).toBe("Bearer sk-test123")
  })
})
```

---

#### 2.4 OpenAI Transport - Audio Streaming

| # | Task | File | Description |
|---|------|------|-------------|
| 2.4.1 | **TEST**: OpenAI audio send/receive | `test/realtime/openai-transport-audio.test.ts` | Test audio chunk handling |
| 2.4.2 | **IMPL**: Audio methods | `src/realtime/openai-transport.ts` | sendAudio, onAudio handlers |

```typescript
// test/realtime/openai-transport-audio.test.ts
import { describe, expect, test, mock, beforeEach } from "bun:test"
// ... mock setup similar to above

describe("OpenAIRealtimeTransport audio", () => {
  test("sendAudio sends input_audio_buffer.append", async () => {
    const transport = new OpenAIRealtimeTransport({ apiKey: "test" })
    await transport.connect({ model: "test", voice: "alloy", instructions: "" })

    transport.sendAudio({ data: "base64audiodata", encoding: "pcm16" })

    const calls = mockWs.send.mock.calls
    const audioCall = calls.find(c => {
      const msg = JSON.parse(c[0])
      return msg.type === "input_audio_buffer.append"
    })
    expect(audioCall).toBeDefined()
    expect(JSON.parse(audioCall[0]).audio).toBe("base64audiodata")
  })

  test("receives audio via response.audio.delta", async () => {
    const transport = new OpenAIRealtimeTransport({ apiKey: "test" })
    const audioHandler = mock(() => {})
    transport.onAudio(audioHandler)

    await transport.connect({ model: "test", voice: "alloy", instructions: "" })

    // Simulate incoming message
    mockWs.onmessage?.({
      data: JSON.stringify({
        type: "response.audio.delta",
        delta: "receivedaudiodata"
      })
    })

    expect(audioHandler).toHaveBeenCalledWith({
      data: "receivedaudiodata",
      encoding: "pcm16"
    })
  })

  test("interrupt sends response.cancel", async () => {
    const transport = new OpenAIRealtimeTransport({ apiKey: "test" })
    await transport.connect({ model: "test", voice: "alloy", instructions: "" })

    transport.interrupt()

    const calls = mockWs.send.mock.calls
    const cancelCall = calls.find(c => JSON.parse(c[0]).type === "response.cancel")
    expect(cancelCall).toBeDefined()
  })
})
```

---

#### 2.5 OpenAI Transport - VAD Events

| # | Task | File | Description |
|---|------|------|-------------|
| 2.5.1 | **TEST**: VAD event handling | `test/realtime/openai-transport-vad.test.ts` | Test speech_started/stopped events |
| 2.5.2 | **IMPL**: VAD handlers | `src/realtime/openai-transport.ts` | Map OpenAI VAD events to transport events |

```typescript
// test/realtime/openai-transport-vad.test.ts
import { describe, expect, test, mock } from "bun:test"
// ... mock setup

describe("OpenAIRealtimeTransport VAD", () => {
  test("maps speech_started event", async () => {
    const transport = new OpenAIRealtimeTransport({ apiKey: "test" })
    const vadHandler = mock(() => {})
    transport.onVAD(vadHandler)
    await transport.connect({ model: "test", voice: "alloy", instructions: "" })

    mockWs.onmessage?.({
      data: JSON.stringify({
        type: "input_audio_buffer.speech_started",
        audio_start_ms: 1500,
        item_id: "item-1"
      })
    })

    expect(vadHandler).toHaveBeenCalledWith({ type: "speech_started", audioStartMs: 1500 })
  })

  test("maps speech_stopped event", async () => {
    const transport = new OpenAIRealtimeTransport({ apiKey: "test" })
    const vadHandler = mock(() => {})
    transport.onVAD(vadHandler)
    await transport.connect({ model: "test", voice: "alloy", instructions: "" })

    mockWs.onmessage?.({
      data: JSON.stringify({
        type: "input_audio_buffer.speech_stopped",
        audio_end_ms: 3500,
        item_id: "item-1"
      })
    })

    expect(vadHandler).toHaveBeenCalledWith({ type: "speech_stopped", audioEndMs: 3500 })
  })
})
```

---

#### 2.6 OpenAI Transport - Transcripts

| # | Task | File | Description |
|---|------|------|-------------|
| 2.6.1 | **TEST**: Transcript handling | `test/realtime/openai-transport-transcript.test.ts` | Test partial/final transcript events |
| 2.6.2 | **IMPL**: Transcript handlers | `src/realtime/openai-transport.ts` | Map transcript events |

```typescript
// test/realtime/openai-transport-transcript.test.ts
describe("OpenAIRealtimeTransport transcripts", () => {
  test("emits partial assistant transcript", async () => {
    const transport = new OpenAIRealtimeTransport({ apiKey: "test" })
    const handler = mock(() => {})
    transport.onTranscript(handler)
    await transport.connect({ model: "test", voice: "alloy", instructions: "" })

    mockWs.onmessage?.({
      data: JSON.stringify({
        type: "response.audio_transcript.delta",
        delta: "Hello"
      })
    })

    expect(handler).toHaveBeenCalledWith("Hello", "assistant", false)
  })

  test("emits final user transcript", async () => {
    const transport = new OpenAIRealtimeTransport({ apiKey: "test" })
    const handler = mock(() => {})
    transport.onTranscript(handler)
    await transport.connect({ model: "test", voice: "alloy", instructions: "" })

    mockWs.onmessage?.({
      data: JSON.stringify({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "How are you?"
      })
    })

    expect(handler).toHaveBeenCalledWith("How are you?", "user", true)
  })
})
```

---

#### 2.7 OpenAI Transport - Tool Calls

| # | Task | File | Description |
|---|------|------|-------------|
| 2.7.1 | **TEST**: Tool call handling | `test/realtime/openai-transport-tools.test.ts` | Test function call events |
| 2.7.2 | **IMPL**: Tool call handlers | `src/realtime/openai-transport.ts` | Handle tool calls and responses |

```typescript
// test/realtime/openai-transport-tools.test.ts
describe("OpenAIRealtimeTransport tools", () => {
  test("emits tool call event", async () => {
    const transport = new OpenAIRealtimeTransport({ apiKey: "test" })
    const handler = mock(() => {})
    transport.onToolCall(handler)
    await transport.connect({ model: "test", voice: "alloy", instructions: "" })

    mockWs.onmessage?.({
      data: JSON.stringify({
        type: "response.function_call_arguments.done",
        call_id: "call-123",
        name: "get_weather",
        arguments: '{"city": "NYC"}'
      })
    })

    expect(handler).toHaveBeenCalledWith({
      callId: "call-123",
      name: "get_weather",
      args: { city: "NYC" }
    })
  })

  test("respondToTool sends conversation.item.create", async () => {
    const transport = new OpenAIRealtimeTransport({ apiKey: "test" })
    await transport.connect({ model: "test", voice: "alloy", instructions: "" })

    transport.respondToTool("call-123", { temperature: 72 })

    const calls = mockWs.send.mock.calls
    const toolResponse = calls.find(c => {
      const msg = JSON.parse(c[0])
      return msg.type === "conversation.item.create" && msg.item.type === "function_call_output"
    })
    expect(toolResponse).toBeDefined()
    expect(JSON.parse(toolResponse[0]).item.call_id).toBe("call-123")
  })
})
```

---

#### 2.8 Transport Factory

| # | Task | File | Description |
|---|------|------|-------------|
| 2.8.1 | **TEST**: Transport factory | `test/realtime/factory.test.ts` | Test factory creates correct transport by provider |
| 2.8.2 | **IMPL**: Transport factory | `src/realtime/factory.ts` | Factory function for creating transports |

```typescript
// test/realtime/factory.test.ts
import { describe, expect, test } from "bun:test"
import { createRealtimeTransport } from "../../src/realtime/factory"
import { OpenAIRealtimeTransport } from "../../src/realtime/openai-transport"

describe("createRealtimeTransport", () => {
  test("creates OpenAI transport for openai provider", () => {
    const transport = createRealtimeTransport("openai", "gpt-4o-realtime-preview", {
      apiKey: "test"
    })
    expect(transport).toBeInstanceOf(OpenAIRealtimeTransport)
  })

  test("throws for unsupported provider", () => {
    expect(() => createRealtimeTransport("anthropic", "model", {}))
      .toThrow("Realtime not supported for provider: anthropic")
  })

  test("throws for non-realtime model", () => {
    expect(() => createRealtimeTransport("openai", "gpt-4o", { apiKey: "test" }))
      .toThrow("Model gpt-4o does not support realtime")
  })
})
```

---

### Phase 3: Server WebSocket Route

**Goal**: Implement the server-side WebSocket endpoint for clients.

#### 3.1 Realtime Route - Basic Setup

| # | Task | File | Description |
|---|------|------|-------------|
| 3.1.1 | **TEST**: Route registration | `test/server/realtime-route.test.ts` | Test route exists and accepts WebSocket |
| 3.1.2 | **IMPL**: Route skeleton | `src/server/routes/realtime.ts` | Basic Hono route with upgradeWebSocket |

```typescript
// test/server/realtime-route.test.ts
import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

describe("realtime routes", () => {
  test("route is registered", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        // Check route exists (will return 404 without valid session, but route should exist)
        const response = await app.request("/realtime/invalid-session/connect")
        // 426 = Upgrade Required (correct for non-WebSocket request to WS endpoint)
        // or 404 if session not found
        expect([404, 426]).toContain(response.status)
      }
    })
  })

  test("requires valid session ID", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/realtime/nonexistent/connect")
        expect(response.status).toBe(404)
      }
    })
  })
})
```

---

#### 3.2 Realtime Route - Session Validation

| # | Task | File | Description |
|---|------|------|-------------|
| 3.2.1 | **TEST**: Session validation | `test/server/realtime-session.test.ts` | Test session exists and supports realtime |
| 3.2.2 | **IMPL**: Session validation | `src/server/routes/realtime.ts` | Validate session before upgrade |

```typescript
// test/server/realtime-session.test.ts
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Server } from "../../src/server/server"

describe("realtime session validation", () => {
  test("accepts session with realtime-capable model", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({
          model: { providerID: "openai", modelID: "gpt-4o-realtime-preview" }
        })
        const app = Server.App()

        // Non-WebSocket request should indicate upgrade needed
        const response = await app.request(`/realtime/${session.id}/connect`)
        // We expect either 426 (Upgrade Required) or successful upgrade info
        expect([200, 426]).toContain(response.status)
      }
    })
  })

  test("rejects session with non-realtime model", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({
          model: { providerID: "openai", modelID: "gpt-4o" }
        })
        const app = Server.App()
        const response = await app.request(`/realtime/${session.id}/connect`)
        expect(response.status).toBe(400)
        const body = await response.json()
        expect(body.error).toContain("realtime")
      }
    })
  })
})
```

---

#### 3.3 Realtime Route - Message Routing

| # | Task | File | Description |
|---|------|------|-------------|
| 3.3.1 | **TEST**: Client message routing | `test/server/realtime-routing.test.ts` | Test messages route to transport |
| 3.3.2 | **IMPL**: Message handler | `src/server/routes/realtime.ts` | Route client messages to transport |

---

#### 3.4 Realtime State Management

| # | Task | File | Description |
|---|------|------|-------------|
| 3.4.1 | **TEST**: Connection state | `test/realtime/state.test.ts` | Test Instance.state for realtime connections |
| 3.4.2 | **IMPL**: State management | `src/realtime/state.ts` | Track active realtime connections per instance |

```typescript
// test/realtime/state.test.ts
import { describe, expect, test, mock } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { RealtimeState } from "../../src/realtime/state"

describe("RealtimeState", () => {
  test("tracks active connections", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const state = RealtimeState.get()
        expect(state.connections.size).toBe(0)

        const mockTransport = { disconnect: mock(() => Promise.resolve()) }
        state.connections.set("session-1", mockTransport as any)
        expect(state.connections.size).toBe(1)
      }
    })
  })

  test("disposes connections on instance cleanup", async () => {
    const disconnectMock = mock(() => Promise.resolve())

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const state = RealtimeState.get()
        state.connections.set("session-1", { disconnect: disconnectMock } as any)
      }
    })
    // After Instance.provide completes, dispose should have been called
    expect(disconnectMock).toHaveBeenCalled()
  })
})
```

---

#### 3.5 Mount Realtime Routes

| # | Task | File | Description |
|---|------|------|-------------|
| 3.5.1 | **TEST**: Routes mounted on server | `test/server/server.test.ts` | Verify realtime routes accessible |
| 3.5.2 | **IMPL**: Mount routes | `src/server/server.ts` | Add `.route("/realtime", RealtimeRoutes())` |

---

### Phase 4: Session Integration

**Goal**: Integrate realtime with session message persistence.

#### 4.1 Persist Audio Transcripts

| # | Task | File | Description |
|---|------|------|-------------|
| 4.1.1 | **TEST**: Transcript persistence | `test/session/realtime-persist.test.ts` | Test transcripts saved as AudioPart |
| 4.1.2 | **IMPL**: Persist logic | `src/session/realtime.ts` | Save transcripts to session history |

```typescript
// test/session/realtime-persist.test.ts
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { RealtimeSession } from "../../src/session/realtime"

describe("RealtimeSession persistence", () => {
  test("saves user transcript as AudioPart", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await RealtimeSession.saveTranscript(session.id, {
          role: "user",
          text: "Hello assistant",
          duration: 2000
        })

        const messages = await MessageV2.list(session.id)
        const userMsg = messages.find(m => m.info.role === "user")
        expect(userMsg).toBeDefined()

        const parts = await MessageV2.parts(userMsg!.info.id)
        const audioPart = parts.find(p => p.type === "audio")
        expect(audioPart).toBeDefined()
        expect(audioPart?.transcript).toBe("Hello assistant")
      }
    })
  })

  test("saves assistant transcript as AudioPart", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await RealtimeSession.saveTranscript(session.id, {
          role: "assistant",
          text: "Hi there!",
          duration: 1500
        })

        const messages = await MessageV2.list(session.id)
        const assistantMsg = messages.find(m => m.info.role === "assistant")
        expect(assistantMsg).toBeDefined()
      }
    })
  })
})
```

---

#### 4.2 Realtime Events to Bus

| # | Task | File | Description |
|---|------|------|-------------|
| 4.2.1 | **TEST**: Event publishing | `test/realtime/events.test.ts` | Test realtime events published to Bus |
| 4.2.2 | **IMPL**: Event definitions | `src/realtime/events.ts` | Define Bus events for realtime |

```typescript
// test/realtime/events.test.ts
import { describe, expect, test, mock } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Bus } from "../../src/bus"
import { RealtimeEvent } from "../../src/realtime/events"

describe("RealtimeEvent", () => {
  test("publishes speech_started event", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const handler = mock(() => {})
        const unsub = Bus.subscribe(RealtimeEvent.SpeechStarted, handler)

        await Bus.publish(RealtimeEvent.SpeechStarted, { sessionID: "sess-1" })

        expect(handler).toHaveBeenCalled()
        unsub()
      }
    })
  })

  test("publishes transcript event", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const handler = mock(() => {})
        Bus.subscribe(RealtimeEvent.Transcript, handler)

        await Bus.publish(RealtimeEvent.Transcript, {
          sessionID: "sess-1",
          text: "hello",
          role: "user",
          final: true
        })

        expect(handler).toHaveBeenCalledWith(expect.objectContaining({
          properties: expect.objectContaining({ text: "hello" })
        }))
      }
    })
  })
})
```

---

### Phase 5: Model Configuration

**Goal**: Add realtime models to provider system.

#### 5.1 Realtime Model Detection

| # | Task | File | Description |
|---|------|------|-------------|
| 5.1.1 | **TEST**: isRealtimeModel helper | `test/provider/realtime-model.test.ts` | Test model capability detection |
| 5.1.2 | **IMPL**: Model helpers | `src/provider/realtime.ts` | Add isRealtimeModel, getRealtimeModels |

```typescript
// test/provider/realtime-model.test.ts
import { describe, expect, test } from "bun:test"
import { isRealtimeModel, getRealtimeModels } from "../../src/provider/realtime"

describe("realtime model helpers", () => {
  test("isRealtimeModel returns true for realtime models", () => {
    expect(isRealtimeModel("openai", "gpt-4o-realtime-preview")).toBe(true)
    expect(isRealtimeModel("openai", "gpt-4o-realtime-preview-2024-10-01")).toBe(true)
  })

  test("isRealtimeModel returns false for non-realtime models", () => {
    expect(isRealtimeModel("openai", "gpt-4o")).toBe(false)
    expect(isRealtimeModel("openai", "gpt-4-turbo")).toBe(false)
    expect(isRealtimeModel("anthropic", "claude-3-opus")).toBe(false)
  })

  test("getRealtimeModels returns available models", () => {
    const models = getRealtimeModels()
    expect(models.length).toBeGreaterThan(0)
    expect(models.every(m => m.capabilities.audio)).toBe(true)
  })
})
```

---

#### 5.2 Realtime Model Metadata

| # | Task | File | Description |
|---|------|------|-------------|
| 5.2.1 | **TEST**: Model has audio capability | `test/provider/models-audio.test.ts` | Test realtime models have correct capabilities |
| 5.2.2 | **IMPL**: Model definitions | `src/provider/models.ts` | Add/update realtime model entries |

```typescript
// test/provider/models-audio.test.ts
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Env } from "../../src/util/env"

describe("realtime model capabilities", () => {
  test("gpt-4o-realtime-preview has audio input/output", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: async () => { Env.set("OPENAI_API_KEY", "test") },
      fn: async () => {
        const model = await Provider.getModel("openai", "gpt-4o-realtime-preview")
        expect(model).toBeDefined()
        expect(model?.capabilities.input.audio).toBe(true)
        expect(model?.capabilities.output.audio).toBe(true)
      }
    })
  })

  test("regular gpt-4o does not have audio output", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: async () => { Env.set("OPENAI_API_KEY", "test") },
      fn: async () => {
        const model = await Provider.getModel("openai", "gpt-4o")
        expect(model?.capabilities.output.audio).toBeFalsy()
      }
    })
  })
})
```

---

### Phase 6: Error Handling

**Goal**: Robust error handling for realtime connections.

#### 6.1 Realtime Error Types

| # | Task | File | Description |
|---|------|------|-------------|
| 6.1.1 | **TEST**: Error type definitions | `test/realtime/errors.test.ts` | Test error classes and serialization |
| 6.1.2 | **IMPL**: Error classes | `src/realtime/errors.ts` | Define RealtimeError, ConnectionError, etc. |

```typescript
// test/realtime/errors.test.ts
import { describe, expect, test } from "bun:test"
import {
  RealtimeError,
  RealtimeConnectionError,
  RealtimeAuthError,
  RealtimeTimeoutError
} from "../../src/realtime/errors"

describe("Realtime errors", () => {
  test("RealtimeError has correct name", () => {
    const err = new RealtimeError("test error")
    expect(err.name).toBe("RealtimeError")
    expect(err.message).toBe("test error")
  })

  test("RealtimeConnectionError includes code", () => {
    const err = new RealtimeConnectionError("connection failed", "ECONNREFUSED")
    expect(err.code).toBe("ECONNREFUSED")
    expect(err.toObject()).toMatchObject({
      name: "RealtimeConnectionError",
      code: "ECONNREFUSED"
    })
  })

  test("RealtimeAuthError is retryable false", () => {
    const err = new RealtimeAuthError("invalid key")
    expect(err.retryable).toBe(false)
  })

  test("RealtimeTimeoutError is retryable true", () => {
    const err = new RealtimeTimeoutError("connection timeout")
    expect(err.retryable).toBe(true)
  })
})
```

---

#### 6.2 Reconnection Logic

| # | Task | File | Description |
|---|------|------|-------------|
| 6.2.1 | **TEST**: Exponential backoff | `test/realtime/reconnect.test.ts` | Test reconnection delay calculation |
| 6.2.2 | **IMPL**: Reconnection helper | `src/realtime/reconnect.ts` | Reconnection with backoff |

```typescript
// test/realtime/reconnect.test.ts
import { describe, expect, test } from "bun:test"
import { calculateBackoff, ReconnectionManager } from "../../src/realtime/reconnect"

describe("reconnection", () => {
  describe("calculateBackoff", () => {
    test("starts at base delay", () => {
      expect(calculateBackoff(0, { baseMs: 1000 })).toBe(1000)
    })

    test("doubles each attempt", () => {
      expect(calculateBackoff(1, { baseMs: 1000 })).toBe(2000)
      expect(calculateBackoff(2, { baseMs: 1000 })).toBe(4000)
      expect(calculateBackoff(3, { baseMs: 1000 })).toBe(8000)
    })

    test("caps at max delay", () => {
      expect(calculateBackoff(10, { baseMs: 1000, maxMs: 30000 })).toBe(30000)
    })

    test("adds jitter when enabled", () => {
      const delays = Array.from({ length: 10 }, () =>
        calculateBackoff(1, { baseMs: 1000, jitter: true })
      )
      // With jitter, not all delays should be identical
      const unique = new Set(delays)
      expect(unique.size).toBeGreaterThan(1)
    })
  })

  describe("ReconnectionManager", () => {
    test("tracks attempt count", () => {
      const manager = new ReconnectionManager()
      expect(manager.attempts).toBe(0)
      manager.recordAttempt()
      expect(manager.attempts).toBe(1)
    })

    test("reset clears attempts", () => {
      const manager = new ReconnectionManager()
      manager.recordAttempt()
      manager.recordAttempt()
      manager.reset()
      expect(manager.attempts).toBe(0)
    })

    test("shouldRetry respects maxAttempts", () => {
      const manager = new ReconnectionManager({ maxAttempts: 3 })
      expect(manager.shouldRetry()).toBe(true)
      manager.recordAttempt()
      manager.recordAttempt()
      manager.recordAttempt()
      expect(manager.shouldRetry()).toBe(false)
    })
  })
})
```

---

### Phase 7: SDK Client

**Goal**: Provide client SDK for connecting to realtime endpoint.

#### 7.1 SDK RealtimeClient

| # | Task | File | Description |
|---|------|------|-------------|
| 7.1.1 | **TEST**: RealtimeClient API | `packages/sdk/js/test/realtime.test.ts` | Test client connection/messaging |
| 7.1.2 | **IMPL**: RealtimeClient | `packages/sdk/js/src/realtime.ts` | WebSocket client for realtime |

---

### Phase 8: Audio Utilities (Client-Side)

**Goal**: Audio capture and playback for web clients.

#### 8.1 PCM Processor AudioWorklet

| # | Task | File | Description |
|---|------|------|-------------|
| 8.1.1 | **TEST**: PCM processor output | `packages/app/test/audio-processor.test.ts` | Test AudioWorklet output format |
| 8.1.2 | **IMPL**: AudioWorklet | `packages/app/public/audio-processor.js` | PCM16 chunk processor |

---

#### 8.2 Audio Playback Queue

| # | Task | File | Description |
|---|------|------|-------------|
| 8.2.1 | **TEST**: Playback queue | `packages/app/test/audio-playback.test.ts` | Test audio chunk queuing |
| 8.2.2 | **IMPL**: AudioPlayback class | `packages/app/src/realtime/audio-playback.ts` | Buffered audio playback |

---

### Summary: Task Dependency Graph

```
Phase 1: Types & Protocol
  1.1 Audio Encoding ──┐
  1.2 Protocol Types ──┼──> Phase 2: Transport
  1.3 AudioPart ───────┤
  1.4 RealtimeEventPart┤
  1.5 OpenAI Events ───┘

Phase 2: Transport Layer
  2.1 Interface ───────┐
  2.2 Emitter ─────────┼──> 2.3-2.7 OpenAI Transport ──> 2.8 Factory

Phase 3: Server Routes
  2.8 Factory ─────────┐
  1.3 AudioPart ───────┼──> 3.1-3.5 Realtime Routes

Phase 4: Session Integration
  3.x Routes ──────────┼──> 4.1 Transcript Persistence
  1.3 AudioPart ───────┘    4.2 Bus Events

Phase 5: Model Config
  (independent) ───────────> 5.1-5.2 Model Metadata

Phase 6: Error Handling
  (independent) ───────────> 6.1 Errors, 6.2 Reconnection

Phase 7-8: Client SDK & Audio
  3.x Routes ──────────────> 7.1 SDK Client
  1.1 Audio Encoding ──────> 8.1-8.2 Client Audio
```

---

### Test Execution Order

Run tests in dependency order:

```bash
# Phase 1: Foundation types
bun test test/util/audio.test.ts
bun test test/realtime/protocol.test.ts
bun test test/session/audio-part.test.ts
bun test test/session/realtime-event-part.test.ts
bun test test/realtime/openai-events.test.ts

# Phase 2: Transport
bun test test/realtime/emitter.test.ts
bun test test/realtime/transport.test.ts
bun test test/realtime/openai-transport-*.test.ts
bun test test/realtime/factory.test.ts

# Phase 3: Server
bun test test/server/realtime-*.test.ts
bun test test/realtime/state.test.ts

# Phase 4: Session
bun test test/session/realtime-persist.test.ts
bun test test/realtime/events.test.ts

# Phase 5-6: Config & Errors
bun test test/provider/realtime-model.test.ts
bun test test/provider/models-audio.test.ts
bun test test/realtime/errors.test.ts
bun test test/realtime/reconnect.test.ts

# All realtime tests
bun test --test-name-pattern "realtime"
```

---

## API Considerations

### OpenAI Realtime API Details

**Endpoint**: `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview`

**Audio Format**:
- Input: PCM16, 24kHz, mono (base64 encoded)
- Output: PCM16, 24kHz, mono (base64 encoded)
- Also supports G.711 (µ-law and A-law)

**Key Events (Client → Server)**:
```
session.update           - Configure session settings
input_audio_buffer.append - Send audio chunk
input_audio_buffer.commit - Finalize audio input (manual VAD)
input_audio_buffer.clear  - Clear audio buffer
response.create          - Trigger response generation
response.cancel          - Cancel ongoing response
conversation.item.create - Add text/audio to conversation
```

**Key Events (Server → Client)**:
```
session.created/updated  - Session configuration confirmed
input_audio_buffer.speech_started/stopped - VAD events
conversation.item.created/completed - Conversation item lifecycle
response.created/done    - Response lifecycle
response.audio.delta/done - Audio chunks
response.audio_transcript.delta/done - Transcript chunks
response.function_call_arguments.delta/done - Tool calls
error                    - Error events
```

**Pricing** (as of 2025):
- Audio input: $0.06 / minute (~100 tokens/second)
- Audio output: $0.24 / minute (~200 tokens/second)
- Text tokens: Standard GPT-4o pricing applies

### Session Configuration

```json
{
  "modalities": ["text", "audio"],
  "voice": "alloy",
  "instructions": "System prompt here",
  "input_audio_format": "pcm16",
  "output_audio_format": "pcm16",
  "input_audio_transcription": {
    "model": "whisper-1"
  },
  "turn_detection": {
    "type": "server_vad",
    "threshold": 0.5,
    "prefix_padding_ms": 300,
    "silence_duration_ms": 500,
    "create_response": true
  },
  "tools": [...],
  "temperature": 0.8,
  "max_response_output_tokens": "inf"
}
```

---

## Architecture Decisions

### D1: Server-Side Provider Connection

**Decision**: OpenCode server maintains WebSocket to OpenAI, not client directly

**Rationale**:
- Protects API keys (never exposed to client)
- Enables server-side tool execution
- Allows session persistence
- Consistent with existing provider architecture
- Enables future multi-provider support

**Trade-off**: Additional latency hop (client ↔ server ↔ OpenAI)

---

### D2: Audio Format Standardization

**Decision**: Use PCM16 @ 24kHz internally, transcode at edges if needed

**Rationale**:
- Native format for OpenAI Realtime API
- Lossless, simple to process
- Easy to convert to other formats
- Low CPU overhead

**Trade-off**: Higher bandwidth than compressed formats

---

### D3: Message Persistence Strategy

**Decision**: Persist transcripts only, not raw audio

**Rationale**:
- Audio files are large
- Transcripts provide searchable history
- Reduces storage requirements
- Audio can be optionally stored via URL reference

**Trade-off**: No audio playback of historical conversations (unless URL stored)

---

### D4: VAD Mode Default

**Decision**: Use server-side VAD by default, with manual mode option

**Rationale**:
- Server VAD provides natural conversation flow
- No client-side VAD implementation needed
- Manual mode available for noisy environments
- Push-to-talk as alternative for specific use cases

---

### D5: Tool Execution Location

**Decision**: Tools execute on server, results streamed to client

**Rationale**:
- Consistent with existing tool execution model
- Server has access to project files
- Security: tools run in controlled environment
- Client receives status updates only

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Audio latency too high | Poor UX | Optimize buffer sizes, use audio worklets, consider WebRTC |
| Browser microphone permissions | Feature blocked | Clear permission prompts, fallback instructions |
| No TUI audio support on some platforms | Limited reach | Document requirements, provide alternative modes |
| OpenAI API changes | Breaking changes | Abstract behind transport interface |
| High audio token costs | Expensive usage | Clear cost display, usage limits option |
| Echo/feedback loops | Audio issues | Echo cancellation, PTT mode |

---

## Testing Strategy

### Unit Tests
- Audio encoding/decoding utilities
- Message type serialization
- Transport event handling
- Session state management

### Integration Tests
- WebSocket connection lifecycle
- Audio streaming end-to-end (mocked provider)
- Tool execution during voice
- Reconnection handling

### Manual Testing
- Voice quality assessment
- Latency measurement
- Interruption behavior
- Multi-platform audio capture

---

## Success Metrics

1. **Latency**: < 500ms from speech end to response start
2. **Audio Quality**: Clear, natural speech output
3. **Reliability**: < 1% connection drops per hour
4. **Interruption**: Response stops within 100ms of user speech
5. **Transcript Accuracy**: Matches Whisper-1 baseline

---

## Future Considerations

### Near-term Extensions
- Multiple voice options in settings
- Audio file upload support
- Voice activity visualization
- Custom wake words

### Future Provider Support
- Google Gemini Live API (when available)
- Azure Speech Services
- Local Whisper + TTS fallback

### Advanced Features
- Multi-speaker detection
- Language auto-detection
- Voice cloning integration
- Real-time translation

---

## References

- [OpenAI Realtime API Documentation](https://platform.openai.com/docs/guides/realtime)
- [OpenAI Realtime API Reference](https://platform.openai.com/docs/api-reference/realtime)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)
