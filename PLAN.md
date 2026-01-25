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

## Implementation Phases

### Phase 1: Core Infrastructure (Foundation)

**Goal**: Establish WebSocket transport and basic bidirectional audio streaming

**Tasks**:
1. [ ] Create WebSocket route at `/session/:sessionID/realtime`
2. [ ] Implement `RealtimeTransport` interface
3. [ ] Implement `OpenAIRealtimeTransport`
4. [ ] Add `AudioPart` and `RealtimeEventPart` to message types
5. [ ] Add realtime models to provider metadata (gpt-4o-realtime-preview)
6. [ ] Basic error handling and reconnection logic

**Files to Create/Modify**:
- `src/provider/realtime/transport.ts` (new)
- `src/provider/realtime/openai.ts` (new)
- `src/server/routes/realtime.ts` (new)
- `src/server/server.ts` (add realtime routes)
- `src/session/message-v2.ts` (add AudioPart)
- `src/provider/models.ts` (add realtime models)

**Validation**:
- Can establish WebSocket connection to server
- Server connects to OpenAI Realtime API
- Basic event forwarding works

---

### Phase 2: Audio Pipeline

**Goal**: End-to-end audio streaming with playback

**Tasks**:
1. [ ] Implement audio capture for web (Web Audio API)
2. [ ] Implement audio capture for TUI (sox/native binding)
3. [ ] Implement audio playback with buffering
4. [ ] PCM16 encoding/decoding utilities
5. [ ] Audio chunk batching (optimize for network)
6. [ ] Echo cancellation and noise suppression

**Files to Create/Modify**:
- `packages/app/src/realtime/audio-capture.ts` (new)
- `packages/app/src/realtime/audio-playback.ts` (new)
- `packages/app/public/audio-processor.js` (new, AudioWorklet)
- `src/cli/cmd/tui/audio/capture.ts` (new)
- `src/cli/cmd/tui/audio/playback.ts` (new)
- `src/util/audio.ts` (new, encoding utilities)

**Validation**:
- Can capture microphone audio
- Can play received audio smoothly
- Audio quality is acceptable

---

### Phase 3: Conversation Flow

**Goal**: Natural conversation with VAD and interruptions

**Tasks**:
1. [ ] Handle VAD events (speech_started, speech_stopped)
2. [ ] Implement interruption handling (stop playback, cancel response)
3. [ ] Transcript display (partial + final)
4. [ ] Persist transcripts to session history
5. [ ] Session configuration (voice, VAD settings)
6. [ ] Response buffering for smooth playback

**Files to Create/Modify**:
- `src/session/realtime.ts` (new, session state for realtime)
- `src/server/routes/realtime.ts` (extend with VAD handling)
- `packages/sdk/js/src/realtime.ts` (new, client SDK)

**Validation**:
- VAD correctly detects speech boundaries
- Interruption stops assistant immediately
- Transcripts match audio content

---

### Phase 4: Tool Integration

**Goal**: Enable tool use during voice conversations

**Tasks**:
1. [ ] Map existing tools to OpenAI function calling format
2. [ ] Execute tools on server side
3. [ ] Stream tool results back through WebSocket
4. [ ] Handle tool timeouts and errors
5. [ ] Audio acknowledgment of tool execution

**Files to Create/Modify**:
- `src/provider/realtime/tools.ts` (new, tool mapping)
- `src/server/routes/realtime.ts` (tool execution)

**Validation**:
- Tools execute correctly during voice conversation
- Tool results influence subsequent responses
- Long-running tools don't block audio

---

### Phase 5: UI Integration

**Goal**: Full integration with TUI and Desktop apps

**Tasks**:
1. [ ] TUI voice mode indicator and controls
2. [ ] Desktop app voice button and status
3. [ ] Waveform/level visualization
4. [ ] Voice settings in configuration
5. [ ] Keyboard shortcuts for voice control
6. [ ] Push-to-talk mode option

**Files to Create/Modify**:
- `src/cli/cmd/tui/routes/session/voice.tsx` (new)
- `src/cli/cmd/tui/component/voice-indicator.tsx` (new)
- `packages/app/src/components/VoicePanel.tsx` (new)
- `packages/desktop/src-tauri/src/audio.rs` (native audio for Tauri)

**Validation**:
- Voice mode clearly indicated in UI
- Easy to start/stop voice conversation
- Visual feedback during speech

---

### Phase 6: Polish and Production Readiness

**Goal**: Robust, production-ready implementation

**Tasks**:
1. [ ] Comprehensive error handling
2. [ ] Reconnection with exponential backoff
3. [ ] Audio quality optimization
4. [ ] Latency monitoring and optimization
5. [ ] Cost tracking for audio tokens
6. [ ] Documentation and examples
7. [ ] Unit and integration tests

**Files to Create/Modify**:
- `src/provider/realtime/errors.ts` (new)
- `src/telemetry/realtime.ts` (new)
- `tests/realtime/*.test.ts` (new)
- `docs/realtime.md` (new)

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
