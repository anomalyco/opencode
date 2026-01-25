# Implementation Tasks (TDD Approach)

Each task follows Test-Driven Development: write the test first, then implement.

## Progress Key

- ✅ **Complete** - Implemented and tested
- 🔄 **In Progress** - Currently being worked on
- ⏳ **Pending** - Not started

---

## Phase 1: Foundation Types ✅

**Goal**: Define all types, schemas, and protocol messages before implementation.

### 1.1 Message Part Types ✅

| # | Status | Task | File | Description |
|---|--------|------|------|-------------|
| 1.1.1 | ✅ | AudioPart schema | `src/session/message-v2.ts` | Audio data with transcript, duration, encoding |
| 1.1.2 | ✅ | RealtimeEventPart schema | `src/session/message-v2.ts` | VAD events (speech_started/stopped, connected/disconnected) |
| 1.1.3 | ✅ | ToolStateInterrupted | `src/session/message-v2.ts` | New tool state for interrupted calls |
| 1.1.4 | ✅ | Tests | `test/realtime/types.test.ts` | 18 tests for new message types |

### 1.2 Config Schema ✅

| # | Status | Task | File | Description |
|---|--------|------|------|-------------|
| 1.2.1 | ✅ | RealtimeConfig schema | `src/config/config.ts` | experimental.realtime config (voice, VAD, audio format) |
| 1.2.2 | ✅ | Tests | `test/realtime/config.test.ts` | 9 tests for config validation |

---

## Phase 2: Protocol & Transport ✅

**Goal**: Implement WebSocket protocol types and transport abstraction.

### 2.1 Protocol Types ✅

| # | Status | Task | File | Description |
|---|--------|------|------|-------------|
| 2.1.1 | ✅ | Client event schemas | `src/realtime/protocol.ts` | session.update, input_audio_buffer.*, response.*, conversation.item.create |
| 2.1.2 | ✅ | Server event schemas | `src/realtime/protocol.ts` | session.*, response.audio.*, function_call.*, error |
| 2.1.3 | ✅ | VAD config types | `src/realtime/protocol.ts` | server_vad, semantic_vad, none |
| 2.1.4 | ✅ | Helper functions | `src/realtime/protocol.ts` | parseServerEvent(), serializeClientEvent() |
| 2.1.5 | ✅ | Tests | `test/realtime/protocol.test.ts` | 33 tests for all event types |

### 2.2 Transport Layer ✅

| # | Status | Task | File | Description |
|---|--------|------|------|-------------|
| 2.2.1 | ✅ | Transport interface | `src/realtime/transport.ts` | connect/disconnect/send/on methods |
| 2.2.2 | ✅ | OpenAI transport | `src/realtime/transport.ts` | WebSocket connection using Bun native |
| 2.2.3 | ✅ | Mock transport | `src/realtime/transport.ts` | For testing (simulateServerEvent, getSentEvents) |
| 2.2.4 | ✅ | Tests | `test/realtime/transport.test.ts` | 14 tests including session/function call flows |

---

## Phase 3: Server Integration ✅

**Goal**: Implement server-side WebSocket endpoint.

### 3.1 WebSocket Route ✅

| # | Status | Task | File | Description |
|---|--------|------|------|-------------|
| 3.1.1 | ✅ | Route registration | `src/server/routes/realtime.ts` | `/realtime/:sessionID/connect` endpoint |
| 3.1.2 | ✅ | Session validation | `src/server/routes/realtime.ts` | Validate session before upgrade |
| 3.1.3 | ✅ | Message routing | `src/server/routes/realtime.ts` | Route client messages to transport |
| 3.1.4 | ✅ | Additional endpoints | `src/server/routes/realtime.ts` | /start, /stop, /status endpoints |

### 3.2 Realtime Session ✅

| # | Status | Task | File | Description |
|---|--------|------|------|-------------|
| 3.2.1 | ✅ | RealtimeSession class | `src/realtime/session.ts` | Bridge between client WS and OpenAI WS |
| 3.2.2 | ✅ | State management | `src/realtime/session.ts` | Track active connections per instance |
| 3.2.3 | ✅ | Tests | `test/realtime/session.test.ts` | 15 session lifecycle tests |

---

## Phase 4: Tool Integration ✅

**Goal**: Enable existing tools to work in realtime conversations.

### 4.1 Tool Schema Conversion ✅

| # | Status | Task | File | Description |
|---|--------|------|------|-------------|
| 4.1.1 | ✅ | Zod v4 → OpenAI format | `src/realtime/tools.ts` | Custom converter for Zod v4 schemas |
| 4.1.2 | ✅ | Tests | `test/realtime/tools.test.ts` | 6 conversion tests (simple, optional, enum, nested, arrays) |

### 4.2 Tool Execution ✅

| # | Status | Task | File | Description |
|---|--------|------|------|-------------|
| 4.2.1 | ✅ | Tool executor | `src/realtime/tools.ts` | Execute tools with validation and error handling |
| 4.2.2 | ✅ | Auto-execution in session | `src/realtime/session.ts` | Automatic tool execution on function calls |
| 4.2.3 | ✅ | Interruption handling | `src/realtime/session.ts` | Cancel on VAD speech_started, abort signal support |
| 4.2.4 | ✅ | Tests | `test/realtime/tools.test.ts` | 15 tests for execution and interruption

---

## Phase 5: Transcript Persistence ✅

**Goal**: Persist transcripts and VAD events to session history (no audio storage).

| # | Status | Task | File | Description |
|---|--------|------|------|-------------|
| 5.1 | ✅ | RealtimePersistence module | `src/realtime/persistence.ts` | Handle transcript and VAD events |
| 5.2 | ✅ | User transcript persistence | `src/realtime/persistence.ts` | Save user speech as TextPart |
| 5.3 | ✅ | Assistant transcript persistence | `src/realtime/persistence.ts` | Save assistant speech as TextPart (with delta accumulation) |
| 5.4 | ✅ | VAD event persistence | `src/realtime/persistence.ts` | Save speech_started/stopped as RealtimeEventPart |
| 5.5 | ✅ | Wire into RealtimeSession | `src/realtime/session.ts` | Persistence option with onTranscriptPart callback |
| 5.6 | ✅ | Tests | `test/realtime/persistence.test.ts` | 14 persistence tests

---

## Phase 6a: Web Client ⏳

**Goal**: Voice integration for web app using Web Audio API (no dependencies).

| # | Status | Task | File | Description |
|---|--------|------|------|-------------|
| 6a.1 | ⏳ | RealtimeClient | `packages/app/src/realtime/client.ts` | WebSocket client to server `/realtime` endpoint |
| 6a.2 | ⏳ | AudioCapture | `packages/app/src/realtime/audio-capture.ts` | AudioWorklet for PCM16 mic capture at 24kHz |
| 6a.3 | ⏳ | AudioPlayback | `packages/app/src/realtime/audio-playback.ts` | AudioContext queue for response audio |
| 6a.4 | ⏳ | useRealtime hook | `packages/app/src/realtime/use-realtime.ts` | Solid.js hook for components |
| 6a.5 | ⏳ | VoiceButton component | `packages/app/src/components/voice-button.tsx` | UI toggle for voice mode |
| 6a.6 | ⏳ | Integration | `packages/app/src/components/prompt-input.tsx` | Wire voice into prompt input |

**Key details:**
- Web Audio API: `getUserMedia()` → `AudioWorkletNode` → PCM16 chunks
- Format: PCM16 signed 16-bit little-endian at 24kHz (OpenAI native)
- No resampling if browser supports 24kHz, otherwise downsample from 48kHz
- Playback: Decode base64 → `AudioBuffer` → `AudioBufferSourceNode`

---

## Phase 6b: CLI/TUI Client ⏳

**Goal**: Voice integration for terminal TUI using `@mastra/node-audio`.

| # | Status | Task | File | Description |
|---|--------|------|------|-------------|
| 6b.1 | ⏳ | Add dependency | `package.json` | Add `@mastra/node-audio` |
| 6b.2 | ⏳ | AudioCapture | `src/realtime/audio-node.ts` | `getMicrophoneStream()` wrapper |
| 6b.3 | ⏳ | AudioPlayback | `src/realtime/audio-node.ts` | `playAudio()` stream wrapper |
| 6b.4 | ⏳ | VoiceMode component | `src/cli/cmd/tui/component/voice-mode.tsx` | TUI voice UI |
| 6b.5 | ⏳ | Keybind | `src/cli/cmd/tui/context/keybind.ts` | Hotkey to toggle voice (e.g., `Ctrl+V`) |
| 6b.6 | ⏳ | Integration | `src/cli/cmd/tui/routes/session.tsx` | Wire into session view |

**Key details:**
- `@mastra/node-audio` requires ffmpeg installed
- `getMicrophoneStream()` returns readable stream
- Convert stream to PCM16 base64 chunks
- `playAudio()` accepts readable stream for playback

---

## Test Summary

| Phase | Tests | Status |
|-------|-------|--------|
| Phase 1: Types | 27 | ✅ |
| Phase 2: Protocol & Transport | 47 | ✅ |
| Phase 3: Server | 15 | ✅ |
| Phase 4: Tools | 15 | ✅ |
| Phase 5: Persistence | 14 | ✅ |
| Phase 6a: Web Client | 0 | ⏳ |
| Phase 6b: CLI/TUI Client | 0 | ⏳ |
| **Total** | **118** | - |

---

## Files Created

```
src/realtime/
├── index.ts           ✅ Re-exports
├── protocol.ts        ✅ All Zod schemas for WebSocket events
├── transport.ts       ✅ Transport interface + OpenAI + Mock
├── session.ts         ✅ RealtimeSession class (client WS ↔ OpenAI bridge)
├── tools.ts           ✅ Zod→JSON Schema converter + tool executor
└── persistence.ts     ✅ Transcript and VAD event persistence

src/server/routes/
└── realtime.ts        ✅ WebSocket and REST endpoints

test/realtime/
├── types.test.ts      ✅ AudioPart, RealtimeEventPart, ToolStateInterrupted
├── config.test.ts     ✅ RealtimeConfig schema
├── protocol.test.ts   ✅ All event types
├── transport.test.ts  ✅ Transport interface and flows
├── session.test.ts    ✅ Session lifecycle and message routing
├── tools.test.ts      ✅ Schema conversion and tool execution
└── persistence.test.ts ✅ Transcript persistence tests
```

## Files Modified

```
src/session/message-v2.ts  ✅ AudioPart, RealtimeEventPart, ToolStateInterrupted
src/config/config.ts       ✅ experimental.realtime config
src/server/server.ts       ✅ Mount realtime routes
```
