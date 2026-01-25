# Implementation Tasks (TDD Approach)

Each task follows Test-Driven Development: write the test first, then implement.

## Task Format

| # | Task | File | Description |
|---|------|------|-------------|
| X.Y.1 | **TEST**: Feature name | `test/path/file.test.ts` | Test description |
| X.Y.2 | **IMPL**: Feature name | `src/path/file.ts` | Implementation description |

---

## Phase 1: Protocol & Types Foundation

**Goal**: Define all types, schemas, and protocol messages before implementation.

### 1.1 Audio Encoding Utilities

| # | Task | File | Description |
|---|------|------|-------------|
| 1.1.1 | **TEST**: Audio encoding utilities | `test/util/audio.test.ts` | Test float32ToPcm16, pcm16ToFloat32, base64 encode/decode |
| 1.1.2 | **IMPL**: Audio encoding utilities | `src/util/audio.ts` | Pure functions for PCM16 ↔ Float32 ↔ base64 conversion |

### 1.2 Realtime Protocol Types

| # | Task | File | Description |
|---|------|------|-------------|
| 1.2.1 | **TEST**: Protocol message schemas | `test/realtime/protocol.test.ts` | Test Zod schema validation for all message types |
| 1.2.2 | **IMPL**: Protocol message schemas | `src/realtime/protocol.ts` | Zod schemas for client↔server messages |

### 1.3 AudioPart Message Type

| # | Task | File | Description |
|---|------|------|-------------|
| 1.3.1 | **TEST**: AudioPart schema validation | `test/session/audio-part.test.ts` | Test AudioPart Zod schema and serialization |
| 1.3.2 | **IMPL**: AudioPart schema | `src/session/message-v2.ts` | Add AudioPart to Part discriminated union |

### 1.4 RealtimeEventPart Message Type

| # | Task | File | Description |
|---|------|------|-------------|
| 1.4.1 | **TEST**: RealtimeEventPart schema | `test/session/realtime-event-part.test.ts` | Test RealtimeEventPart validation |
| 1.4.2 | **IMPL**: RealtimeEventPart schema | `src/session/message-v2.ts` | Add RealtimeEventPart to Part union |

### 1.5 OpenAI Realtime Event Types

| # | Task | File | Description |
|---|------|------|-------------|
| 1.5.1 | **TEST**: OpenAI event type mapping | `test/realtime/openai-events.test.ts` | Test OpenAI event schema validation |
| 1.5.2 | **IMPL**: OpenAI event types | `src/realtime/openai-events.ts` | Zod schemas for OpenAI Realtime API events |

---

## Phase 2: Transport Layer

**Goal**: Implement the provider-agnostic transport interface and OpenAI implementation.

### 2.1 Transport Interface

| # | Task | File | Description |
|---|------|------|-------------|
| 2.1.1 | **TEST**: Transport interface contract | `test/realtime/transport.test.ts` | Test mock transport behavior |
| 2.1.2 | **IMPL**: Transport interface | `src/realtime/transport.ts` | Define RealtimeTransport interface and types |

### 2.2 Event Emitter for Transport

| # | Task | File | Description |
|---|------|------|-------------|
| 2.2.1 | **TEST**: Typed event emitter | `test/realtime/emitter.test.ts` | Test type-safe event subscription/emission |
| 2.2.2 | **IMPL**: Typed event emitter | `src/realtime/emitter.ts` | Generic typed event emitter class |

### 2.3 OpenAI Transport - Connection

| # | Task | File | Description |
|---|------|------|-------------|
| 2.3.1 | **TEST**: OpenAI transport connection | `test/realtime/openai-transport-connect.test.ts` | Test WebSocket connection lifecycle |
| 2.3.2 | **IMPL**: OpenAI transport base | `src/realtime/openai-transport.ts` | WebSocket connection and basic setup |

### 2.4 OpenAI Transport - Audio Streaming

| # | Task | File | Description |
|---|------|------|-------------|
| 2.4.1 | **TEST**: OpenAI audio send/receive | `test/realtime/openai-transport-audio.test.ts` | Test audio chunk handling |
| 2.4.2 | **IMPL**: Audio methods | `src/realtime/openai-transport.ts` | sendAudio, onAudio handlers |

### 2.5 OpenAI Transport - VAD Events

| # | Task | File | Description |
|---|------|------|-------------|
| 2.5.1 | **TEST**: VAD event handling | `test/realtime/openai-transport-vad.test.ts` | Test speech_started/stopped events |
| 2.5.2 | **IMPL**: VAD handlers | `src/realtime/openai-transport.ts` | Map OpenAI VAD events to transport events |

### 2.6 OpenAI Transport - Transcripts

| # | Task | File | Description |
|---|------|------|-------------|
| 2.6.1 | **TEST**: Transcript handling | `test/realtime/openai-transport-transcript.test.ts` | Test partial/final transcript events |
| 2.6.2 | **IMPL**: Transcript handlers | `src/realtime/openai-transport.ts` | Map transcript events |

### 2.7 OpenAI Transport - Tool Calls

| # | Task | File | Description |
|---|------|------|-------------|
| 2.7.1 | **TEST**: Tool call handling | `test/realtime/openai-transport-tools.test.ts` | Test function call events |
| 2.7.2 | **IMPL**: Tool call handlers | `src/realtime/openai-transport.ts` | Handle tool calls and responses |

### 2.8 Transport Factory

| # | Task | File | Description |
|---|------|------|-------------|
| 2.8.1 | **TEST**: Transport factory | `test/realtime/factory.test.ts` | Test factory creates correct transport by provider |
| 2.8.2 | **IMPL**: Transport factory | `src/realtime/factory.ts` | Factory function for creating transports |

---

## Phase 3: Server WebSocket Route

**Goal**: Implement the server-side WebSocket endpoint for clients.

### 3.1 Realtime Route - Basic Setup

| # | Task | File | Description |
|---|------|------|-------------|
| 3.1.1 | **TEST**: Route registration | `test/server/realtime-route.test.ts` | Test route exists and accepts WebSocket |
| 3.1.2 | **IMPL**: Route skeleton | `src/server/routes/realtime.ts` | Basic Hono route with upgradeWebSocket |

### 3.2 Realtime Route - Session Validation

| # | Task | File | Description |
|---|------|------|-------------|
| 3.2.1 | **TEST**: Session validation | `test/server/realtime-session.test.ts` | Test session exists and supports realtime |
| 3.2.2 | **IMPL**: Session validation | `src/server/routes/realtime.ts` | Validate session before upgrade |

### 3.3 Realtime Route - Message Routing

| # | Task | File | Description |
|---|------|------|-------------|
| 3.3.1 | **TEST**: Client message routing | `test/server/realtime-routing.test.ts` | Test messages route to transport |
| 3.3.2 | **IMPL**: Message handler | `src/server/routes/realtime.ts` | Route client messages to transport |

### 3.4 Realtime State Management

| # | Task | File | Description |
|---|------|------|-------------|
| 3.4.1 | **TEST**: Connection state | `test/realtime/state.test.ts` | Test Instance.state for realtime connections |
| 3.4.2 | **IMPL**: State management | `src/realtime/state.ts` | Track active realtime connections per instance |

### 3.5 Mount Realtime Routes

| # | Task | File | Description |
|---|------|------|-------------|
| 3.5.1 | **TEST**: Routes mounted on server | `test/server/server.test.ts` | Verify realtime routes accessible |
| 3.5.2 | **IMPL**: Mount routes | `src/server/server.ts` | Add `.route("/realtime", RealtimeRoutes())` |

---

## Phase 4: Session Integration

**Goal**: Integrate realtime with session message persistence.

### 4.1 Persist Audio Transcripts

| # | Task | File | Description |
|---|------|------|-------------|
| 4.1.1 | **TEST**: Transcript persistence | `test/session/realtime-persist.test.ts` | Test transcripts saved as AudioPart |
| 4.1.2 | **IMPL**: Persist logic | `src/session/realtime.ts` | Save transcripts to session history |

### 4.2 Realtime Events to Bus

| # | Task | File | Description |
|---|------|------|-------------|
| 4.2.1 | **TEST**: Event publishing | `test/realtime/events.test.ts` | Test realtime events published to Bus |
| 4.2.2 | **IMPL**: Event definitions | `src/realtime/events.ts` | Define Bus events for realtime |

---

## Phase 4B: Tool Integration for Realtime

**Goal**: Enable existing opencode tools to work in realtime voice conversations.

### 4B.1 Tool Schema Conversion

| # | Task | File | Description |
|---|------|------|-------------|
| 4B.1.1 | **TEST**: Convert Tool.Info to OpenAI format | `test/realtime/tools-convert.test.ts` | Test Zod → OpenAI function schema |
| 4B.1.2 | **IMPL**: Tool conversion | `src/realtime/tools.ts` | Convert opencode tools to realtime format |

### 4B.2 ToolStateInterrupted

| # | Task | File | Description |
|---|------|------|-------------|
| 4B.2.1 | **TEST**: Interrupted state schema | `test/session/tool-interrupted.test.ts` | Test new ToolState variant |
| 4B.2.2 | **IMPL**: Add interrupted state | `src/session/message-v2.ts` | Extend ToolState union |

### 4B.3 Realtime Tool Executor

| # | Task | File | Description |
|---|------|------|-------------|
| 4B.3.1 | **TEST**: Execute tool in realtime context | `test/realtime/tools-execute.test.ts` | Test tool execution with realtime context |
| 4B.3.2 | **IMPL**: Realtime executor | `src/realtime/tools.ts` | Execute tools, handle interruption |

### 4B.4 Tool Call Event Handler

| # | Task | File | Description |
|---|------|------|-------------|
| 4B.4.1 | **TEST**: Handle function_call events | `test/realtime/tools-handler.test.ts` | Test event → execution → response flow |
| 4B.4.2 | **IMPL**: Event handler | `src/realtime/openai-transport.ts` | Handle tool calls in transport |

### 4B.5 Tool Interruption Handling

| # | Task | File | Description |
|---|------|------|-------------|
| 4B.5.1 | **TEST**: Interrupt running tool | `test/realtime/tools-interrupt.test.ts` | Test VAD interruption during tool |
| 4B.5.2 | **IMPL**: Interruption logic | `src/realtime/tools.ts` | Handle abort, update ToolPart state |

---

## Phase 5: Model Configuration

**Goal**: Add realtime models to provider system.

### 5.1 Realtime Model Detection

| # | Task | File | Description |
|---|------|------|-------------|
| 5.1.1 | **TEST**: isRealtimeModel helper | `test/provider/realtime-model.test.ts` | Test model capability detection |
| 5.1.2 | **IMPL**: Model helpers | `src/provider/realtime.ts` | Add isRealtimeModel, getRealtimeModels |

### 5.2 Realtime Model Metadata

| # | Task | File | Description |
|---|------|------|-------------|
| 5.2.1 | **TEST**: Model has audio capability | `test/provider/models-audio.test.ts` | Test realtime models have correct capabilities |
| 5.2.2 | **IMPL**: Model definitions | `src/provider/models.ts` | Add/update realtime model entries |

---

## Phase 6: Error Handling

**Goal**: Robust error handling for realtime connections.

### 6.1 Realtime Error Types

| # | Task | File | Description |
|---|------|------|-------------|
| 6.1.1 | **TEST**: Error type definitions | `test/realtime/errors.test.ts` | Test error classes and serialization |
| 6.1.2 | **IMPL**: Error classes | `src/realtime/errors.ts` | Define RealtimeError, ConnectionError, etc. |

### 6.2 Reconnection Logic

| # | Task | File | Description |
|---|------|------|-------------|
| 6.2.1 | **TEST**: Exponential backoff | `test/realtime/reconnect.test.ts` | Test reconnection delay calculation |
| 6.2.2 | **IMPL**: Reconnection helper | `src/realtime/reconnect.ts` | Reconnection with backoff |

---

## Phase 7: SDK Client

**Goal**: Provide client SDK for connecting to realtime endpoint.

### 7.1 SDK RealtimeClient

| # | Task | File | Description |
|---|------|------|-------------|
| 7.1.1 | **TEST**: RealtimeClient API | `packages/sdk/js/test/realtime.test.ts` | Test client connection/messaging |
| 7.1.2 | **IMPL**: RealtimeClient | `packages/sdk/js/src/realtime.ts` | WebSocket client for realtime |

---

## Phase 8: Audio Utilities (Client-Side)

**Goal**: Audio capture and playback for web clients.

### 8.1 PCM Processor AudioWorklet

| # | Task | File | Description |
|---|------|------|-------------|
| 8.1.1 | **TEST**: PCM processor output | `packages/app/test/audio-processor.test.ts` | Test AudioWorklet output format |
| 8.1.2 | **IMPL**: AudioWorklet | `packages/app/public/audio-processor.js` | PCM16 chunk processor |

### 8.2 Audio Playback Queue

| # | Task | File | Description |
|---|------|------|-------------|
| 8.2.1 | **TEST**: Playback queue | `packages/app/test/audio-playback.test.ts` | Test audio chunk queuing |
| 8.2.2 | **IMPL**: AudioPlayback class | `packages/app/src/realtime/audio-playback.ts` | Buffered audio playback |

---

## Task Dependency Graph

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

Phase 4B: Tool Integration (Critical Path)
  Existing Tool.Info ──┐
  2.7 Tool Calls ──────┼──> 4B.1 Schema Conversion
  MessageV2.ToolState ─┘    4B.2 Interrupted State
                            4B.3 Realtime Executor
                            4B.4 Event Handler
                            4B.5 Interruption Handling

Phase 5: Model Config
  (independent) ───────────> 5.1-5.2 Model Metadata

Phase 6: Error Handling
  (independent) ───────────> 6.1 Errors, 6.2 Reconnection

Phase 7-8: Client SDK & Audio
  3.x Routes ──────────────> 7.1 SDK Client
  1.1 Audio Encoding ──────> 8.1-8.2 Client Audio
```

---

## Test Execution Order

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

# Phase 4B: Tool Integration
bun test test/realtime/tools-convert.test.ts
bun test test/session/tool-interrupted.test.ts
bun test test/realtime/tools-execute.test.ts
bun test test/realtime/tools-handler.test.ts
bun test test/realtime/tools-interrupt.test.ts

# Phase 5-6: Config & Errors
bun test test/provider/realtime-model.test.ts
bun test test/provider/models-audio.test.ts
bun test test/realtime/errors.test.ts
bun test test/realtime/reconnect.test.ts

# All realtime tests
bun test --test-name-pattern "realtime"
```

---

## File Summary

### New Files to Create

```
src/realtime/
├── protocol.ts          # Client↔Server message schemas
├── openai-events.ts     # OpenAI Realtime API event types
├── transport.ts         # RealtimeTransport interface
├── openai-transport.ts  # OpenAI implementation
├── factory.ts           # Transport factory
├── emitter.ts           # Typed event emitter
├── state.ts             # Connection state management
├── events.ts            # Bus events for realtime
├── errors.ts            # Error types
├── reconnect.ts         # Reconnection logic
└── tools.ts             # Tool conversion and execution

src/server/routes/
└── realtime.ts          # WebSocket route handler

src/util/
└── audio.ts             # PCM16 encoding utilities

test/realtime/
├── protocol.test.ts
├── openai-events.test.ts
├── transport.test.ts
├── openai-transport-*.test.ts
├── factory.test.ts
├── emitter.test.ts
├── state.test.ts
├── events.test.ts
├── errors.test.ts
├── reconnect.test.ts
├── tools-*.test.ts
└── ...

test/session/
├── audio-part.test.ts
├── realtime-event-part.test.ts
├── realtime-persist.test.ts
└── tool-interrupted.test.ts

test/server/
├── realtime-route.test.ts
├── realtime-session.test.ts
└── realtime-routing.test.ts

test/provider/
├── realtime-model.test.ts
└── models-audio.test.ts
```

### Files to Modify

```
src/session/message-v2.ts     # Add AudioPart, RealtimeEventPart, ToolStateInterrupted
src/server/server.ts          # Mount realtime routes
src/provider/models.ts        # Add realtime model entries
```
