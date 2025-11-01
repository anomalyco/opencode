# OpenCode LiveKit Integration Architecture

## Vision

A simplified LiveKit integration that enables **room-based voice collaboration** with:

1. **Basic Room Functionality**:
   - Connect to LiveKit server
   - Create or join rooms
   - Mic access for speaking
   - Audio playback from other participants

2. **OpenCode Room Agent**:
   - Single agent that joins LiveKit rooms
   - Transcribes conversations automatically
   - Takes notes and manages todos
   - Provides AI assistance to room participants

3. **Bidirectional Tool Sharing**:
   - OpenCode agent exposes its tools to external voice agents in the room
   - External voice agents (like LiveKit Agents) can expose their tools to OpenCode
   - Tool execution flows through LiveKit data channels

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        LiveKit Room                              │
│                                                                   │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐│
│  │   Human    │  │   Human    │  │  External  │  │  OpenCode  ││
│  │Participant │  │Participant │  │Voice Agent │  │Room Agent  ││
│  │            │  │            │  │            │  │            ││
│  │ 🎤 Audio   │  │ 🎤 Audio   │  │ 🎤 Audio   │  │ 🎤 Audio   ││
│  │ 📡 Data    │  │ 📡 Data    │  │ 📡 Data    │  │ 📡 Data    ││
│  │            │  │            │  │ 🛠️ Tools   │  │ 🛠️ Tools   ││
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘│
│                                          │              │        │
│                                          └──────┬───────┘        │
│                                                 │                │
│                                    Bidirectional Tool Access     │
└─────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Room Manager (`room-manager.ts`)

Handles basic LiveKit room operations:

```typescript
class RoomManager {
  // Connection
  connect(serverUrl: string, token: string): Promise<Room>
  disconnect(): Promise<void>

  // Room operations
  createRoom(name: string): Promise<Room>
  joinRoom(name: string): Promise<Room>
  leaveRoom(): Promise<void>

  // Audio
  enableMicrophone(): Promise<void>
  disableMicrophone(): Promise<void>
  setMicrophoneVolume(level: number): Promise<void>

  // Participants
  getParticipants(): Participant[]
  getRemoteAudioTracks(): AudioTrack[]
}
```

### 2. OpenCode Room Agent (`room-agent.ts`)

An AI agent that joins rooms and provides assistance:

```typescript
class OpenCodeRoomAgent {
  // Core capabilities
  transcribe: boolean // Auto-transcribe conversations
  takeNotes: boolean // Generate notes from discussions
  manageTodos: boolean // Track action items

  // Agent functions
  async joinRoom(roomName: string): Promise<void>
  async leaveRoom(): Promise<void>

  // Conversation processing
  async onSpeech(text: string, speaker: string): Promise<void>
  async summarizeConversation(): Promise<string>
  async generateNotes(): Promise<Note[]>
  async extractTodos(): Promise<Todo[]>

  // Tool integration
  async registerTool(tool: Tool): Promise<void>
  async executeTool(toolName: string, params: any): Promise<any>
}
```

### 3. Tool Bridge (`tool-bridge.ts`)

Bidirectional tool sharing between agents:

```typescript
class ToolBridge {
  // Expose OpenCode tools to external agents
  async exposeTools(tools: Tool[]): Promise<void>

  // Discover and use external agent tools
  async discoverExternalTools(): Promise<Tool[]>
  async executeExternalTool(agentId: string, toolName: string, params: any): Promise<any>

  // Data channel messaging
  async sendToolRequest(request: ToolRequest): Promise<ToolResponse>
  async handleToolRequest(request: ToolRequest): Promise<ToolResponse>
}
```

### 4. Transcription Service (`transcription.ts`)

Real-time speech-to-text for room conversations:

```typescript
class TranscriptionService {
  // Speech recognition
  async startTranscription(): Promise<void>
  async stopTranscription(): Promise<void>

  // Events
  on('interim', (text: string, speaker: string) => void)
  on('final', (text: string, speaker: string) => void)
  on('error', (error: Error) => void)

  // Configuration
  setLanguage(language: string): void
  setProvider(provider: 'browser' | 'deepgram' | 'openai'): void
}
```

## Data Flow

### Voice Communication

```
Human → Microphone → LiveKit → Room Participants → Speaker
```

### Transcription Flow

```
Speech → TranscriptionService → OpenCodeRoomAgent → Notes/Todos
```

### Tool Execution Flow

```
External Agent → ToolBridge (Data Channel) → OpenCode Tools → Result → External Agent
OpenCode → ToolBridge (Data Channel) → External Agent Tools → Result → OpenCode
```

## Use Cases

### 1. Team Meeting with AI Assistance

- Team joins LiveKit room via browser
- OpenCode agent joins room automatically
- Agent transcribes conversation in real-time
- Agent extracts action items and creates todos
- Agent can answer questions using OpenCode tools

### 2. Voice Agent Collaboration

- External voice agent (e.g., LiveKit Agent with GPT-4) joins room
- OpenCode agent joins room
- Both agents share their tools via data channels
- External agent can use OpenCode tools (file reading, code search, etc.)
- OpenCode can use external agent tools (web search, data lookup, etc.)

### 3. Solo Voice Coding

- Developer joins room alone
- OpenCode agent provides voice assistance
- Developer speaks commands naturally
- Agent executes OpenCode tools via voice
- Agent takes notes and tracks todos

## Implementation Plan

### Phase 1: Basic Room Functionality

- [ ] Room connection/disconnection
- [ ] Microphone access and control
- [ ] Audio playback from participants
- [ ] Basic participant management

### Phase 2: OpenCode Room Agent

- [ ] Agent joins/leaves rooms
- [ ] Real-time transcription
- [ ] Note generation from conversations
- [ ] Todo extraction and management

### Phase 3: Tool Bridge

- [ ] Tool registration and discovery
- [ ] Data channel messaging protocol
- [ ] Bidirectional tool execution
- [ ] Security and permission handling

### Phase 4: CLI & Integration

- [ ] `opencode room join <name>` command
- [ ] `opencode room create <name>` command
- [ ] `opencode room agent start` command
- [ ] Integration with existing OpenCode tools

## Technical Decisions

### 1. Audio Handling

- **Browser**: Use WebRTC MediaStream API
- **Node.js**: Use node-speaker/node-microphone (optional)
- **Bun**: Native audio support when available

### 2. Transcription

- **Default**: Browser Web Speech API (free, good quality)
- **Optional**: Deepgram (paid, better accuracy)
- **Future**: OpenAI Whisper (best accuracy, slower)

### 3. Tool Protocol

Use data channels with JSON-RPC 2.0 format:

```json
{
  "jsonrpc": "2.0",
  "method": "tool.execute",
  "params": {
    "tool": "read_file",
    "arguments": { "path": "/src/index.ts" }
  },
  "id": "req-123"
}
```

### 4. Security

- Tool execution requires explicit permission grants
- Room agents authenticate with tokens
- Data channel messages are signed and verified
- Rate limiting on tool execution

## Dependencies

```json
{
  "livekit-client": "^2.5.7", // Room connection and WebRTC
  "livekit-server-sdk": "^2.6.0", // Token generation
  "@deepgram/sdk": "^3.0.0", // Optional: Better STT
  "openai": "^4.0.0" // AI processing
}
```

## Configuration

```bash
# .env or opencode.json
LIVEKIT_URL=wss://your-server.livekit.cloud
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret

# Optional
DEEPGRAM_API_KEY=your-deepgram-key
OPENAI_API_KEY=your-openai-key
```

## Next Steps

1. Start with basic room connection and audio
2. Add OpenCode room agent with transcription
3. Implement simple note-taking and todo extraction
4. Build tool bridge for bidirectional access
5. Add CLI commands for easy room management
6. Write comprehensive tests and documentation
