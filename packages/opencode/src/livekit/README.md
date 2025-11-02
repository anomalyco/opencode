# OpenCode LiveKit Integration

Room-based voice collaboration with AI assistance. Connect to LiveKit rooms, transcribe conversations, take notes, manage todos, and share tools between agents.

## Features

- 🎤 **Voice Input** - Capture audio from system microphone
- 🔊 **Audio Playback** - Hear audio from remote participants (AI agents, etc.)
- 🤖 **AI Agent** - Intelligent assistant that joins rooms
- 📝 **Transcription** - Real-time speech-to-text
- 📋 **Note Taking** - Automatic note generation
- ✅ **Todo Extraction** - Action item detection
- 🛠️ **Tool Sharing** - Bidirectional tool access between agents
- 🔒 **Secure** - Permission system and rate limiting

## Quick Start

### 1. Configure LiveKit

Set environment variables:

```bash
export LIVEKIT_URL="wss://your-server.livekit.cloud"
export LIVEKIT_API_KEY="your-api-key"
export LIVEKIT_API_SECRET="your-api-secret"
```

Or add to `opencode.json`:

```json
{
  "livekit": {
    "serverUrl": "wss://your-server.livekit.cloud",
    "apiKey": "your-api-key",
    "apiSecret": "your-api-secret"
  }
}
```

### 2. Start an AI Agent

```bash
opencode room agent start
```

You'll be prompted for:

- Room name
- Agent configuration

Or provide options:

```bash
opencode room agent start \
  --room my-meeting \
  --name assistant \
  --transcribe \
  --notes \
  --todos
```

### 3. Join a Room (Coming Soon)

```bash
opencode room join my-meeting
```

## Commands

### Room Operations

```bash
# Join a room
opencode room join <name>

# Create a room
opencode room create <name>

# List available rooms
opencode room list

# Leave current room
opencode room leave
```

### Agent Management

```bash
# Start agent (interactive)
opencode room agent start

# Start agent with options
opencode room agent start --room <name> --transcribe --notes --todos

# Stop agent
opencode room agent stop

# Show agent status
opencode room agent status
```

## Architecture

### Components

#### RoomManager

Handles LiveKit room connections and audio.

```typescript
import { RoomManager } from "opencode/livekit"

const manager = new RoomManager({
  serverUrl: "wss://your-server.livekit.cloud",
  apiKey: "your-api-key",
  apiSecret: "your-api-secret",
})

// Connect to room
await manager.connect({
  name: "my-room",
  participantName: "alice",
})

// Microphone control (auto-enabled on connect)
await manager.enableMicrophone()
await manager.setMicrophoneVolume(0.8)

// Audio playback control (auto-enabled on connect)
manager.setPlaybackVolume(0.9) // Control speaker volume
const volume = manager.getPlaybackVolume()

// Get participants
const participants = manager.getParticipants()
```

#### TranscriptionService

Real-time speech-to-text using Web Speech API.

```typescript
import { TranscriptionService } from "opencode/livekit"

const transcription = new TranscriptionService({
  provider: "browser", // or 'deepgram', 'openai'
  language: "en-US",
  interimResults: true,
})

// Listen for transcription results
transcription.on("final", (result) => {
  console.log(`${result.speaker}: ${result.text}`)
})

// Start transcribing
await transcription.startTranscription()
```

#### OpenCodeRoomAgent

AI agent that joins rooms and provides assistance.

```typescript
import { createRoomAgent } from "opencode/livekit"

const agent = createRoomAgent(
  // LiveKit config
  {
    serverUrl: "wss://your-server.livekit.cloud",
    apiKey: "your-api-key",
    apiSecret: "your-api-secret",
  },
  // Agent config
  {
    name: "assistant",
    roomName: "my-meeting",
    capabilities: {
      transcribe: true,
      takeNotes: true,
      manageTodos: true,
      answerQuestions: true,
      executeTools: true,
    },
  },
)

// Join room
await agent.joinRoom()

// Listen for events
agent.on("noteCreated", (note) => {
  console.log("New note:", note.content)
})

agent.on("todoCreated", (todo) => {
  console.log("New todo:", todo.content)
})

// Generate summary
const summary = await agent.summarizeConversation()
```

#### ToolBridge

Bidirectional tool sharing between agents.

```typescript
import { createToolBridge } from "opencode/livekit"

const bridge = createToolBridge(roomManager)

// Expose OpenCode tools
await bridge.exposeTools([
  {
    name: "read_file",
    description: "Read a file from disk",
    parameters: [{ name: "path", type: "string", required: true, description: "File path" }],
    execute: async (params) => {
      return await Bun.file(params.path).text()
    },
  },
])

// Discover external tools
const externalTools = await bridge.discoverExternalTools()

// Execute external tool
const result = await bridge.executeExternalTool("external-agent-id", "search_web", {
  query: "OpenCode LiveKit",
})
```

## Use Cases

### 1. Team Meetings with AI Notes

```bash
# Start agent in meeting room
opencode room agent start --room team-standup --notes --todos

# The agent will:
# - Join the room as "opencode-assistant"
# - Transcribe all conversation
# - Generate notes for important points
# - Extract action items automatically
# - Create todos with priorities
```

### 2. Voice Coding Session

```bash
# Start agent with tools enabled
opencode room agent start --room coding-session

# The agent can:
# - Transcribe your voice commands
# - Execute OpenCode tools via voice
# - Take notes about decisions
# - Track todos from your voice
```

### 3. Multi-Agent Collaboration

```bash
# Start OpenCode agent
opencode room agent start --room multi-agent

# OpenCode agent will:
# - Share its tools (file reading, code search, etc.)
# - Discover tools from other agents in the room
# - Execute external agent tools
# - Allow external agents to use OpenCode tools
```

## Configuration

### Environment Variables

```bash
# Required
LIVEKIT_URL=wss://your-server.livekit.cloud
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret

# Optional
DEEPGRAM_API_KEY=your-deepgram-key  # For better transcription
OPENAI_API_KEY=your-openai-key      # For AI responses
```

### opencode.json

```json
{
  "livekit": {
    "serverUrl": "wss://your-server.livekit.cloud",
    "apiKey": "your-api-key",
    "apiSecret": "your-api-secret",
    "defaultRoom": "opencode-room",
    "agent": {
      "autoJoin": false,
      "transcribe": true,
      "takeNotes": true,
      "manageTodos": true
    },
    "audio": {
      "echoCancellation": true,
      "noiseSuppression": true,
      "autoGainControl": true
    }
  }
}
```

## Audio System

OpenCode provides full-duplex audio communication:

- **Audio Capture**: Records from your system microphone using `node-record-lpcm16`
- **Audio Playback**: Plays audio from remote participants using `speaker`

Both are automatically enabled when connecting to a LiveKit room.

### Requirements

#### Audio Capture (Microphone)

Requires **SoX** (Sound eXchange) for microphone capture:

**macOS:**

```bash
brew install sox
```

**Linux (Ubuntu/Debian):**

```bash
sudo apt-get install sox libsox-fmt-all
```

**Linux (Fedora/RHEL):**

```bash
sudo dnf install sox
```

**Windows:**

Download and install from [SoX SourceForge](https://sourceforge.net/projects/sox/)

#### Audio Playback (Speakers)

The `speaker` package is already included in dependencies. It requires:

**macOS:** CoreAudio (built-in)

**Linux:** ALSA development libraries

```bash
sudo apt-get install libasound2-dev
```

**Windows:** WASAPI (built-in)

After installing dependencies, rebuild the native module:

```bash
npm rebuild speaker
```

See [AUDIO_PLAYBACK_SETUP.md](./AUDIO_PLAYBACK_SETUP.md) for detailed setup instructions.

### How It Works

#### Audio Capture (Your Microphone → LiveKit)

1. **Microphone Capture** - Captures PCM16 audio from system microphone at 48kHz
2. **Frame Processing** - Converts audio into 20ms frames (960 samples)
3. **LiveKit Streaming** - Feeds frames to LiveKit's AudioSource via `captureFrame()`
4. **Volume Control** - Applies volume adjustments in real-time
5. **Mute Support** - Stops/starts capture for mute functionality

#### Audio Playback (LiveKit → Your Speakers)

1. **Track Subscription** - Subscribes to remote audio tracks automatically
2. **Audio Streaming** - Reads AudioFrames from LiveKit's AudioStream
3. **Multi-Track Mixing** - Combines audio from multiple participants
4. **Speaker Output** - Plays mixed audio through system speakers
5. **Volume Control** - Adjusts playback volume independently

See [AUDIO_PLAYBACK.md](./AUDIO_PLAYBACK.md) for detailed documentation.

### Automatic Microphone Enabling

When you connect to a LiveKit room, the microphone is **automatically enabled**:

```typescript
// Connect to room (microphone auto-enabled)
await manager.connect({
  name: "my-room",
  participantName: "OpenCode User",
})
// Microphone is now capturing and streaming audio
```

### Manual Control

You can also control the microphone manually:

```typescript
// Enable microphone
await manager.enableMicrophone()

// Disable microphone
await manager.disableMicrophone()

// Toggle microphone
const enabled = await manager.toggleMicrophone()

// Set volume (0.0 to 1.0)
await manager.setMicrophoneVolume(0.8)

// Mute/unmute
await manager.setMicrophoneMuted(true)

// Get microphone state
const state = manager.getMicrophoneState()
// { enabled: true, volume: 0.8, muted: false }
```

### Audio Configuration

Configure audio settings in `opencode.json`:

```json
{
  "livekit": {
    "audio": {
      "sampleRate": 48000,
      "channelCount": 1,
      "echoCancellation": true,
      "noiseSuppression": true,
      "autoGainControl": true
    }
  }
}
```

### Troubleshooting

**"sox: not found" error:**

- Install SoX using the commands above

**No audio in LiveKit room:**

- Check microphone permissions on your system
- Verify SoX is installed: `sox --version`
- Check microphone state: `manager.getMicrophoneState()`

**Audio quality issues:**

- Ensure sample rate is set to 48000 Hz
- Enable audio processing (echo cancellation, noise suppression)
- Check microphone volume level

## Agent Capabilities

### Transcription

The agent automatically transcribes all speech in the room:

```
[alice]: Let's discuss the new feature
[bob]: I think we should implement it this week
[opencode-assistant]: *transcribing and taking notes*
```

### Note Generation

The agent detects important phrases and creates notes:

**Triggers**:

- "important"
- "remember"
- "note that"
- "key point"
- "decision"
- "agreed"

**Example**:

```
[alice]: "The important decision is to use TypeScript"
→ Note created: "Decision: Use TypeScript"
```

### Todo Extraction

The agent extracts action items from conversation:

**Patterns**:

- "need to ..."
- "should ..."
- "must ..."
- "will ..."
- "todo: ..."
- "action item: ..."

**Priority Detection**:

- High: "urgent", "asap", "critical", "immediately"
- Medium: "soon", "important"
- Low: everything else

**Example**:

```
[bob]: "We need to finish the documentation asap"
→ Todo created: "finish the documentation" (Priority: high)
```

### Tool Sharing

The agent shares OpenCode tools with external agents using JSON-RPC 2.0:

**Discovery**:

```json
{
  "type": "tool.discovery",
  "payload": {
    "agentId": "opencode",
    "tools": [
      {
        "name": "read_file",
        "description": "Read a file from disk",
        "parameters": [...]
      }
    ]
  }
}
```

**Execution**:

```json
{
  "jsonrpc": "2.0",
  "method": "tool.execute",
  "params": {
    "tool": "read_file",
    "arguments": { "path": "/src/index.ts" }
  },
  "id": "req_123"
}
```

## Events

### Room Events

```typescript
roomManager.on("connected", (state) => {
  console.log("Connected to room:", state.roomName)
})

roomManager.on("participantJoined", (participant) => {
  console.log("Participant joined:", participant.name)
})

roomManager.on("participantLeft", (participant) => {
  console.log("Participant left:", participant.name)
})

roomManager.on("dataReceived", (message, participant) => {
  console.log("Data from", participant.name, ":", message)
})

roomManager.on("speakingChanged", (participant, isSpeaking) => {
  console.log(participant.name, isSpeaking ? "started" : "stopped", "speaking")
})
```

### Transcription Events

```typescript
transcription.on("interim", (result) => {
  console.log("Interim:", result.text)
})

transcription.on("final", (result) => {
  console.log("Final:", result.text, "(confidence:", result.confidence, ")")
})

transcription.on("error", (error) => {
  console.error("Transcription error:", error)
})
```

### Agent Events

```typescript
agent.on("noteCreated", (note) => {
  console.log("Note:", note.content)
  console.log("Type:", note.type)
  console.log("Speaker:", note.speaker)
})

agent.on("todoCreated", (todo) => {
  console.log("Todo:", todo.content)
  console.log("Priority:", todo.priority)
  console.log("Assignee:", todo.assignee)
})

agent.on("summaryGenerated", (summary) => {
  console.log("Summary:", summary)
})
```

## Security

### Permission System

Tools require explicit permission before execution:

```typescript
// Grant permission
bridge.grantPermission("agent-id", "read_file")

// Grant with expiration (1 hour)
bridge.grantPermission("agent-id", "read_file", 3600000)

// Revoke permission
bridge.revokePermission("agent-id", "read_file")

// Check permissions
const permissions = bridge.getPermissions()
```

### Rate Limiting

- **60 requests per minute** per agent
- Automatically enforced by ToolBridge
- Prevents abuse and flooding

### Message Security

- All data channel messages are JSON
- Invalid messages are ignored
- Timeout protection (30 seconds)

## Troubleshooting

### "LiveKit configuration missing!"

**Problem**: Missing LiveKit credentials.

**Solution**: Set environment variables or configure `opencode.json`:

```bash
export LIVEKIT_URL="wss://your-server.livekit.cloud"
export LIVEKIT_API_KEY="your-api-key"
export LIVEKIT_API_SECRET="your-api-secret"
```

### "Web Speech API not supported"

**Problem**: Browser doesn't support Web Speech API.

**Solution**: Use a supported browser:

- Chrome/Edge (recommended)
- Safari (partial support)

Or use Deepgram provider:

```bash
export DEEPGRAM_API_KEY="your-deepgram-key"
```

### "Failed to connect to LiveKit room"

**Problem**: Invalid credentials or network issues.

**Solutions**:

1. Check server URL is correct
2. Verify API key and secret
3. Test network connectivity
4. Check LiveKit server status

### Agent not transcribing

**Problem**: Microphone access denied or transcription disabled.

**Solutions**:

1. Enable transcription: `--transcribe`
2. Grant microphone permissions in browser
3. Check transcription service is running

### Tool execution timeout

**Problem**: Tool took longer than 30 seconds.

**Solutions**:

1. Optimize tool execution
2. Split into smaller operations
3. Increase timeout (requires code change)

## Examples

### Basic Room Agent

```typescript
import { createRoomAgent } from "opencode/livekit"

const agent = createRoomAgent(
  {
    serverUrl: process.env.LIVEKIT_URL!,
    apiKey: process.env.LIVEKIT_API_KEY!,
    apiSecret: process.env.LIVEKIT_API_SECRET!,
  },
  {
    name: "my-assistant",
    roomName: "dev-team",
    capabilities: {
      transcribe: true,
      takeNotes: true,
      manageTodos: true,
      answerQuestions: false,
      executeTools: false,
    },
  },
)

await agent.joinRoom()

// Get notes after meeting
const notes = await agent.generateNotes()
console.log("Meeting notes:", notes)

// Get todos
const todos = await agent.extractTodos()
console.log("Action items:", todos)

// Generate summary
const summary = await agent.summarizeConversation()
console.log("Summary:", summary)
```

### Custom Tool Sharing

```typescript
import { RoomManager, createToolBridge } from "opencode/livekit"

const manager = new RoomManager(liveKitConfig)
await manager.connect({ name: "dev-room" })

const bridge = createToolBridge(manager)

// Expose custom tools
await bridge.exposeTools([
  {
    name: "analyze_code",
    description: "Analyze code for issues",
    parameters: [{ name: "code", type: "string", required: true, description: "Code to analyze" }],
    execute: async (params) => {
      // Your analysis logic
      return { issues: [], suggestions: [] }
    },
  },
  {
    name: "run_tests",
    description: "Run test suite",
    parameters: [{ name: "pattern", type: "string", required: false, description: "Test pattern" }],
    execute: async (params) => {
      // Run tests
      return { passed: 10, failed: 0 }
    },
  },
])

console.log("Tools exposed to room participants")
```

## Resources

- [LiveKit Documentation](https://docs.livekit.io/)
- [LiveKit Cloud](https://cloud.livekit.io/)
- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- [Deepgram](https://deepgram.com/)
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)

## Getting LiveKit Credentials

### 1. LiveKit Cloud (Recommended)

1. Sign up at [cloud.livekit.io](https://cloud.livekit.io/)
2. Create a new project
3. Copy your credentials:
   - Server URL: `wss://your-project.livekit.cloud`
   - API Key: From project settings
   - API Secret: From project settings

### 2. Self-Hosted LiveKit

1. Follow [LiveKit self-hosting guide](https://docs.livekit.io/deploy/)
2. Start LiveKit server
3. Configure with your server URL and keys

### 3. Local Development

```bash
# Run LiveKit locally with Docker
docker run --rm -p 7880:7880 \
  -e LIVEKIT_KEYS="devkey: secret" \
  livekit/livekit-server \
  --dev

# Use in OpenCode
export LIVEKIT_URL="ws://localhost:7880"
export LIVEKIT_API_KEY="devkey"
export LIVEKIT_API_SECRET="secret"
```

## Roadmap

- [ ] Deepgram integration for better transcription
- [ ] OpenAI Whisper integration
- [ ] Voice output (agent speaks responses)
- [ ] Real-time transcription UI
- [ ] Browser-based room joining
- [ ] Room recording and playback
- [ ] Advanced permission UI
- [ ] Tool marketplace
- [ ] Multi-language support
- [ ] Custom wake words
- [ ] Voice commands

## Contributing

Contributions welcome! Areas that need work:

1. **Transcription Providers**: Add Deepgram, OpenAI Whisper
2. **Voice Output**: TTS integration for agent responses
3. **UI**: Real-time transcription display
4. **Testing**: Integration tests with local LiveKit
5. **Documentation**: More examples and tutorials

## License

Same as OpenCode main license.
