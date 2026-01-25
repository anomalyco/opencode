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

## Phase 3: Server Integration ⏳

**Goal**: Implement server-side WebSocket endpoint.

### 3.1 WebSocket Route

| # | Status | Task | File | Description |
|---|--------|------|------|-------------|
| 3.1.1 | ⏳ | Route registration | `src/server/routes/realtime.ts` | `/realtime/:sessionID/connect` endpoint |
| 3.1.2 | ⏳ | Session validation | `src/server/routes/realtime.ts` | Validate session before upgrade |
| 3.1.3 | ⏳ | Message routing | `src/server/routes/realtime.ts` | Route client messages to transport |
| 3.1.4 | ⏳ | Tests | `test/server/realtime-route.test.ts` | Route and WebSocket tests |

### 3.2 Realtime Session

| # | Status | Task | File | Description |
|---|--------|------|------|-------------|
| 3.2.1 | ⏳ | RealtimeSession class | `src/realtime/session.ts` | Bridge between client WS and OpenAI WS |
| 3.2.2 | ⏳ | State management | `src/realtime/session.ts` | Track active connections per instance |
| 3.2.3 | ⏳ | Tests | `test/realtime/session.test.ts` | Session lifecycle tests |

---

## Phase 4: Tool Integration ⏳

**Goal**: Enable existing tools to work in realtime conversations.

### 4.1 Tool Schema Conversion

| # | Status | Task | File | Description |
|---|--------|------|------|-------------|
| 4.1.1 | ⏳ | Tool.Info → OpenAI format | `src/realtime/tools.ts` | Convert Zod schemas to OpenAI function format |
| 4.1.2 | ⏳ | Tests | `test/realtime/tools.test.ts` | Conversion tests with existing tools |

### 4.2 Tool Execution

| # | Status | Task | File | Description |
|---|--------|------|------|-------------|
| 4.2.1 | ⏳ | Realtime tool executor | `src/realtime/tools.ts` | Execute tools, handle results |
| 4.2.2 | ⏳ | Interruption handling | `src/realtime/tools.ts` | Cancel on VAD, update to interrupted state |
| 4.2.3 | ⏳ | Tests | `test/realtime/tools.test.ts` | Execution and interruption tests |

---

## Phase 5: Session Persistence ⏳

**Goal**: Persist transcripts and events to session history.

| # | Status | Task | File | Description |
|---|--------|------|------|-------------|
| 5.1 | ⏳ | Save transcripts | `src/session/realtime.ts` | Save as AudioPart with transcript |
| 5.2 | ⏳ | Bus events | `src/realtime/events.ts` | Publish realtime events to Bus |
| 5.3 | ⏳ | Tests | `test/session/realtime.test.ts` | Persistence tests |

---

## Phase 6: Client Audio ⏳

**Goal**: Audio capture and playback for web/desktop clients.

| # | Status | Task | File | Description |
|---|--------|------|------|-------------|
| 6.1 | ⏳ | AudioWorklet processor | `packages/app/` | PCM16 capture from microphone |
| 6.2 | ⏳ | Audio playback queue | `packages/app/` | Buffered playback of response audio |
| 6.3 | ⏳ | SDK RealtimeClient | `packages/sdk/` | WebSocket client for realtime |

---

## Test Summary

| Phase | Tests | Status |
|-------|-------|--------|
| Phase 1: Types | 27 | ✅ |
| Phase 2: Protocol & Transport | 47 | ✅ |
| Phase 3: Server | 0 | ⏳ |
| Phase 4: Tools | 0 | ⏳ |
| Phase 5: Persistence | 0 | ⏳ |
| Phase 6: Client | 0 | ⏳ |
| **Total** | **74** | - |

---

## Files Created

```
src/realtime/
├── index.ts           ✅ Re-exports
├── protocol.ts        ✅ All Zod schemas for WebSocket events
└── transport.ts       ✅ Transport interface + OpenAI + Mock

test/realtime/
├── types.test.ts      ✅ AudioPart, RealtimeEventPart, ToolStateInterrupted
├── config.test.ts     ✅ RealtimeConfig schema
├── protocol.test.ts   ✅ All event types
└── transport.test.ts  ✅ Transport interface and flows
```

## Files Modified

```
src/session/message-v2.ts  ✅ AudioPart, RealtimeEventPart, ToolStateInterrupted
src/config/config.ts       ✅ experimental.realtime config
```
