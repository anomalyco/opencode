# Realtime Voice Roadmap

This document outlines the phased approach to implementing realtime voice support in opencode.

## Vision

Enable truly conversational coding assistance where developers can speak naturally with opencode, have it read files, write code, run commands, and explain concepts - all through voice with seamless interruption and tool use.

**North Star**: A developer can say "Hey, look at the auth module and fix that bug we discussed" and opencode understands context, reads relevant files, makes changes, and explains what it did - all while allowing natural back-and-forth conversation.

---

## Phase 1: MVP - Basic Voice Conversation

**Goal**: Establish bidirectional audio streaming with transcript persistence.

**Scope**:
- WebSocket connection between client and server
- Server-to-OpenAI Realtime API connection
- Audio streaming (PCM16 @ 24kHz)
- VAD-based turn detection
- Transcript persistence (AudioPart in session history)
- Basic error handling and reconnection

**Not in Scope**:
- Tool calling
- Multiple voices
- Client-side audio (use external client initially)

**Success Criteria**:
- Can have a voice conversation via WebSocket
- Transcripts saved to session
- Reconnects on disconnect

**Estimated Complexity**: Medium

---

## Phase 2: Tool Integration

**Goal**: Enable voice-triggered tool use with existing opencode tools.

**Scope**:
- Convert Tool.Info to OpenAI function format
- Handle `function_call_arguments.done` events
- Execute tools through existing `Tool.execute()` pipeline
- Permission system integration
- ToolStateInterrupted for VAD interruptions
- Tool results fed back to model

**Key Behaviors**:
```
User: "Read the config file"
       ↓ (VAD silence)
Model: Decides to call read_file tool
       ↓
Server: Executes read_file, returns content
       ↓
Model: "The config file contains... [explains]"
```

**Success Criteria**:
- Can ask "read file X" and get voice response with contents
- Tools respect permission system
- Interrupted tools transition to `interrupted` state

**Estimated Complexity**: Medium-High

---

## Phase 3: Client Audio Integration

**Goal**: Integrate audio capture/playback into opencode clients.

### 3a: Web/Desktop Client
- Web Audio API for capture (24kHz PCM16)
- AudioWorklet for processing
- Buffered playback with interruption support
- Microphone permission handling
- Voice activity indicator UI

### 3b: TUI Client
- Native audio capture (sox, FFI, or node module)
- Speaker playback
- Voice mode indicator in terminal
- Keyboard shortcut to toggle voice

**Success Criteria**:
- Can speak to opencode via TUI or Desktop app
- Audio plays through speakers
- Visual feedback during speech

**Estimated Complexity**: High (platform-specific)

---

## Phase 4: Conversation Polish

**Goal**: Natural, production-quality voice interactions.

**Scope**:
- Multiple voice options (alloy, echo, shimmer, etc.)
- Configurable VAD settings
- Push-to-talk mode
- Cost tracking and display
- Conversation history context
- Improved error messages (spoken)

**Success Criteria**:
- Users can configure voice preference
- Cost visible in session
- Graceful handling of edge cases

**Estimated Complexity**: Medium

---

## Phase 5: Advanced - Dual Agent Architecture

**Goal**: Voice agent delegates complex tasks to a more capable text agent.

### The Problem

The Realtime API (GPT-4o) is optimized for low-latency voice but:
- Less capable at complex reasoning than text models (Claude, GPT-4)
- Can't call tools while user is still speaking
- Limited context window for long coding sessions

### The Solution: Delegation

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Voice Agent (GPT-4o Realtime)                │
│  - Handles real-time conversation                                   │
│  - Quick responses, natural speech                                  │
│  - Decides when to delegate                                         │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │ Delegates complex tasks
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Text Agent (Claude/GPT-4)                      │
│  - Complex reasoning and planning                                   │
│  - Multi-file edits                                                 │
│  - Long context understanding                                       │
│  - Runs asynchronously                                              │
└─────────────────────────────────────────────────────────────────────┘
```

### Interaction Patterns

**Pattern 1: Synchronous Delegation**
```
User: "Refactor the auth module to use JWT"
Voice Agent: "Let me work on that refactoring..."
  → Delegates to Text Agent
  → Waits for completion
Voice Agent: "Done! I've updated 5 files. The main changes are..."
```

**Pattern 2: Asynchronous Delegation**
```
User: "Start refactoring the auth module"
Voice Agent: "I'll start working on that in the background.
              Feel free to ask me other things."
  → Delegates to Text Agent (async)
  → Continues conversation
User: "What's the status?"
Voice Agent: "The refactoring is 60% complete. I've updated 3 of 5 files."
```

**Pattern 3: Proactive Preparation**
```
User: "I want to discuss the payment system"
Voice Agent: "Sure, let me pull up the relevant files..."
  → Delegates: "Read payment-related files, summarize"
  → Text Agent reads files, returns summary
Voice Agent: "I see we have 3 payment providers configured.
              What would you like to know?"
```

### Implementation Considerations

| Aspect | Approach |
|--------|----------|
| Delegation trigger | Voice agent decides based on task complexity |
| Communication | Internal tool call: `delegate_to_text_agent` |
| State sync | Text agent results stored in session, voice agent reads |
| Interruption | User can interrupt, text agent task continues in background |
| Feedback | Voice agent provides progress updates |

### New Tools for Delegation

```typescript
// Voice agent's delegation tool
{
  name: "delegate_complex_task",
  description: "Delegate a complex coding task to a more capable agent",
  parameters: {
    task: string,           // What to do
    files: string[],        // Relevant files
    waitForResult: boolean, // Sync or async
    priority: "high" | "normal"
  }
}

// Check on async task
{
  name: "check_task_status",
  description: "Check the status of a delegated task",
  parameters: {
    taskId: string
  }
}
```

**Success Criteria**:
- Voice agent can delegate to text agent
- Async tasks run in background
- User can check status via voice
- Results integrated into conversation

**Estimated Complexity**: Very High

---

## Phase 6: Future Explorations

### 6a: Multi-Modal Input
- Screen sharing / screenshot analysis
- "Look at this error" with visual context
- Diagram understanding

### 6b: Proactive Agent
- Agent notices issues and speaks up
- "I noticed a potential bug in the file you just saved"
- Requires always-on listening (privacy considerations)

### 6c: Team/Multi-User
- Multiple developers in voice session
- Speaker identification
- Shared context

### 6d: Local/Offline Voice
- Local Whisper for STT
- Local TTS (Piper, Coqui)
- Fallback when OpenAI unavailable
- Privacy-sensitive environments

---

## Timeline Considerations

| Phase | Dependencies | Relative Effort |
|-------|--------------|-----------------|
| 1. MVP | None | ██░░░ |
| 2. Tools | Phase 1 | ███░░ |
| 3. Clients | Phase 1 | ████░ |
| 4. Polish | Phases 1-3 | ██░░░ |
| 5. Dual Agent | Phases 1-2 | █████ |
| 6. Future | Phases 1-4 | ░░░░░ (exploratory) |

**Recommended Order**: 1 → 2 → 3a (web) → 4 → 3b (TUI) → 5

---

## Open Questions

### Q1: Voice Agent Model Selection
Should the voice agent always be GPT-4o Realtime, or could we support:
- Gemini Live (when available)
- Future Claude voice API

### Q2: Delegation Transparency
Should users know when delegation happens?
- Transparent: "Let me ask my coding assistant..."
- Seamless: Just does it, reports results

### Q3: Cost Management
Realtime API is expensive ($0.06-0.24/min). Options:
- Usage limits
- Automatic fallback to text mode
- Voice for conversation, text for coding

### Q4: Conversation Memory
How much context to maintain across sessions?
- Full transcript history
- Summarized context
- Key decisions only

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Voice-to-response latency | < 500ms |
| Tool execution success rate | > 95% |
| Transcript accuracy | > 95% (Whisper baseline) |
| User interruption responsiveness | < 100ms |
| Session stability | < 1% disconnects/hour |
| Cost per minute of conversation | Track and display |
