# Architecture Decisions

This document records key architecture decisions for the realtime integration.

---

## D1: Server-Side Provider Connection

**Decision**: OpenCode server maintains WebSocket to OpenAI, not client directly.

```
Client ←WebSocket→ OpenCode Server ←WebSocket→ OpenAI Realtime API
```

**Rationale**:
- Protects API keys (never exposed to client)
- Enables server-side tool execution with file system access
- Allows session persistence and message history
- Consistent with existing provider architecture
- Enables future multi-provider support

**Trade-off**: Additional latency hop (~10-50ms per message).

**Alternatives Considered**:
- Direct client → OpenAI connection: Exposes API key, can't run tools
- Hybrid (client sends audio, server sends tools): Complex state sync

---

## D2: Audio Format Standardization

**Decision**: Use PCM16 @ 24kHz internally, transcode at edges if needed.

**Rationale**:
- Native format for OpenAI Realtime API
- Lossless, simple to process
- Easy to convert to other formats
- Low CPU overhead
- Web Audio API can output 24kHz directly

**Trade-off**: Higher bandwidth than compressed formats (~48KB/s vs ~6KB/s for Opus).

**Future Option**: Add Opus support for low-bandwidth scenarios.

---

## D3: Message Persistence Strategy

**Decision**: Persist transcripts only, not raw audio by default.

**Rationale**:
- Audio files are large (~2.8MB per minute of stereo audio)
- Transcripts provide searchable history
- Reduces storage requirements
- Audio can be optionally stored via `url` field reference

**Trade-off**: No audio playback of historical conversations unless explicitly stored.

**Configuration**:
```typescript
// Future: optional audio persistence
realtime: {
  persistAudio: false,  // Default
  audioStorage: "local" | "s3" | "none"
}
```

---

## D4: VAD Mode Default

**Decision**: Use server-side VAD by default, with manual mode option.

**Rationale**:
- Server VAD provides natural conversation flow
- No client-side VAD implementation needed
- OpenAI's VAD is well-tuned for speech
- Manual mode available for noisy environments or precise control

**Configuration**:
```typescript
turnDetection: {
  type: "server_vad",
  threshold: 0.5,
  silenceDurationMs: 500
}
// or
turnDetection: { type: "none" }  // Push-to-talk
```

---

## D5: Tool Execution Location

**Decision**: Tools execute on server, results streamed to client.

**Rationale**:
- Consistent with existing tool execution model
- Server has access to project files and system
- Security: tools run in controlled environment
- Client receives status updates only

**Trade-off**: Tool results must be serialized and sent to OpenAI, then vocalized.

---

## D6: SDK Choice

**Decision**: Use raw WebSocket with custom transport, not higher-level SDKs.

**Rationale**:
- Reuse existing `Tool.Info` and `ToolRegistry` unchanged
- Full control over audio buffering and latency
- No external dependencies to track
- Same transport interface for future providers

**Alternatives Rejected**:
- OpenAI Agents SDK: Different tool format, conflicts with session system
- @openai/realtime-api-beta: Adds dependency, tool format differs

See [sdk-choice.md](./sdk-choice.md) for detailed analysis.

---

## D7: Interruption Handling

**Decision**: On user speech during assistant response, immediately cancel and stop playback.

**Flow**:
1. VAD detects user speech → `speech_started` event
2. Server sends `response.cancel` to OpenAI
3. Server aborts running tools (via AbortSignal)
4. Client stops audio playback
5. New user turn begins

**Rationale**:
- Matches natural conversation behavior
- Prevents talking over each other
- User intent to interrupt is clear signal

**Trade-off**: Partial responses are lost. Could optionally save partial transcript.

---

## D8: Tool State Extension

**Decision**: Add `interrupted` state to ToolState discriminated union.

```typescript
ToolState = "pending" | "running" | "completed" | "error" | "interrupted"
```

**Rationale**:
- Clearly distinguishes user-caused interruption from errors
- Allows partial results to be preserved
- Enables better UX (show "interrupted" vs "failed")

**Backward Compatibility**: Existing code treats unknown states as errors.

---

## D9: WebSocket Route Path

**Decision**: Mount realtime routes at `/realtime/:sessionID/connect`.

**Rationale**:
- Clear separation from HTTP routes (`/session/...`)
- Session ID in path matches REST conventions
- `/connect` suffix clarifies WebSocket upgrade intent

**Alternative Considered**: `/session/:sessionID/realtime` - rejected to avoid confusion with existing session routes.

---

## D10: Event Bus Integration

**Decision**: Publish realtime events through existing Bus system.

**Events**:
```typescript
RealtimeEvent.SpeechStarted
RealtimeEvent.SpeechStopped
RealtimeEvent.Transcript
RealtimeEvent.AudioChunk
RealtimeEvent.ToolCall
RealtimeEvent.Connected
RealtimeEvent.Disconnected
```

**Rationale**:
- Consistent with existing event patterns
- TUI/Desktop can subscribe without WebSocket client
- Enables logging, analytics, debugging

---

## D11: Reconnection Strategy

**Decision**: Exponential backoff with jitter, max 5 attempts.

```typescript
delays = [1000, 2000, 4000, 8000, 16000] // ms, with ±20% jitter
```

**Rationale**:
- Handles transient network issues
- Jitter prevents thundering herd
- 5 attempts covers ~30 seconds of retries
- After max attempts, surface error to user

**State Preservation**: On reconnect, re-send session configuration but not conversation history (OpenAI doesn't persist between connections).

---

## D12: Permission Handling in Realtime

**Decision**: Pause audio, show UI prompt for permissions, resume after response.

**Flow**:
1. Tool requests permission via `ctx.ask()`
2. Server pauses, sends permission request to client
3. Client shows permission dialog (UI or voice prompt)
4. User responds (button click or voice command)
5. Tool execution continues or rejects

**Challenge**: Voice-based permission granting needs careful UX design.

**Options**:
- UI buttons (safest, clearest)
- Voice commands: "Yes, allow" / "No, deny"
- Confirmation tone + auto-approve for low-risk actions

---

## D13: Cost Tracking

**Decision**: Track audio tokens separately from text tokens.

```typescript
tokens: {
  input: number,
  output: number,
  reasoning: number,
  cache: { read: number, write: number },
  audio: {           // NEW
    input: number,   // ~100 tokens/second of input audio
    output: number   // ~200 tokens/second of output audio
  }
}
```

**Rationale**:
- Audio tokens are 4-8x more expensive than text
- Users need visibility into costs
- Enables usage limits and alerts

---

## Open Questions

### Q1: Multi-turn Context Window

How much conversation history should be sent to OpenAI on reconnect?
- **Current**: None (clean slate on reconnect)
- **Future**: Could send recent transcript as text context

### Q2: Concurrent Sessions

Should multiple realtime sessions be allowed per user?
- **Current**: One active realtime session at a time
- **Future**: Could support multiple (expensive)

### Q3: Hybrid Mode

Should users be able to switch between text and voice mid-conversation?
- **Current**: Separate modes
- **Future**: Seamless switching with shared context
