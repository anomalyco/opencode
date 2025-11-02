# OpenCode LiveKit Integration - Complete Documentation

A comprehensive voice collaboration system that enables real-time communication, AI assistance, and bidirectional tool sharing between OpenCode and external agents through LiveKit rooms.

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Architecture](#architecture)
4. [Setup Instructions](#setup-instructions)
5. [Usage Guide](#usage-guide)
6. [CLI Commands](#cli-commands)
7. [Session Manager Integration](#session-manager-integration)
8. [Agent Collaboration](#agent-collaboration)
9. [Tool Sharing](#tool-sharing)
10. [Files Created/Modified](#files-createdmodified)
11. [Configuration](#configuration)
12. [Troubleshooting](#troubleshooting)
13. [Examples](#examples)
14. [API Reference](#api-reference)

---

## Overview

The OpenCode LiveKit integration provides a complete voice collaboration platform that transforms how developers interact with AI assistants and collaborate across different agents. This system enables:

- **Real-time voice communication** through LiveKit rooms
- **AI-powered transcription** and conversation processing
- **Automatic note-taking** and todo extraction
- **Bidirectional tool sharing** between OpenCode and external agents
- **Session-aware integration** with OpenCode's existing architecture
- **Permission-based security** for tool access

### What Was Built

This integration consists of several interconnected components:

1. **Room Manager** - Handles LiveKit connections and audio control
2. **Room Agent** - AI assistant that joins rooms and provides help
3. **Session Manager** - Integrates with OpenCode sessions for seamless tool sharing
4. **Tool Bridge** - Enables bidirectional tool execution between agents
5. **Transcription Service** - Real-time speech-to-text with note extraction
6. **CLI Commands** - Easy-to-use commands for room operations
7. **Type System** - Complete TypeScript definitions for all components

---

## Features

### 🎤 Voice Communication

- Connect to LiveKit rooms with audio support
- Microphone enable/disable/toggle functionality
- Participant management and presence detection
- Audio track subscription and playback

### 🤖 AI Room Agent

- Intelligent assistant that joins LiveKit rooms
- Real-time conversation transcription
- Automatic note generation from discussions
- Todo extraction with priority detection
- Speaker identification and conversation tracking

### 🛠️ Bidirectional Tool Sharing

- Expose OpenCode tools to external agents
- Execute tools from external agents in the room
- JSON-RPC 2.0 protocol for secure communication
- Permission system with expiration support
- Rate limiting to prevent abuse

### 📝 Smart Content Processing

- **Note Detection**: Automatically creates notes for important phrases
- **Todo Extraction**: Identifies action items with priorities
- **Speaker Tracking**: Maintains conversation history by participant
- **Tag Support**: Extract hashtags and keywords from speech

### 🔧 Session Integration

- Seamless integration with OpenCode sessions
- Automatic tool exposure when connecting to rooms
- Session-aware tool execution context
- Automatic cleanup on session deletion

### 🔒 Security Features

- Permission-based tool access control
- Rate limiting (60 requests/minute per agent)
- Message validation and timeout protection
- Secure token-based LiveKit authentication

---

## Architecture

### System Overview

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

### Component Architecture

```
OpenCode LiveKit Integration
├── RoomManager (room-manager.ts)
│   ├── LiveKit connection management
│   ├── Audio track control
│   ├── Participant tracking
│   └── Data channel messaging
│
├── SessionManager (session-manager.ts)
│   ├── OpenCode session integration
│   ├── Tool exposure automation
│   ├── Connection state management
│   └── Event coordination
│
├── RoomAgent (room-agent.ts)
│   ├── AI conversation processing
│   ├── Note generation
│   ├── Todo extraction
│   └── Real-time transcription
│
├── ToolBridge (tool-bridge.ts)
│   ├── Tool registration
│   ├── External tool discovery
│   ├── Permission management
│   └── Rate limiting
│
├── TranscriptionService (transcription.ts)
│   ├── Web Speech API integration
│   ├── Real-time speech processing
│   ├── Speaker identification
│   └── Confidence scoring
│
└── CLI Commands (cli/cmd/room.ts)
    ├── Room operations
    ├── Agent management
    ├── Configuration helpers
    └── Interactive prompts
```

---

## Setup Instructions

### 1. Prerequisites

- OpenCode installed and configured
- LiveKit server access (cloud or self-hosted)
- Microphone access for transcription
- Modern browser with Web Speech API support (for browser-based usage)

### 2. Get LiveKit Credentials

#### Option A: LiveKit Cloud (Recommended)

1. Sign up at [cloud.livekit.io](https://cloud.livekit.io/)
2. Create a new project
3. Copy your credentials:
   - **Server URL**: `wss://your-project.livekit.cloud`
   - **API Key**: From project settings
   - **API Secret**: From project settings

#### Option B: Self-Hosted LiveKit

1. Follow the [LiveKit deployment guide](https://docs.livekit.io/deploy/)
2. Configure your server URL and generate API keys
3. Ensure WebRTC and data channel support is enabled

#### Option C: Local Development

```bash
# Run LiveKit locally with Docker
docker run --rm -p 7880:7880 \
  -e LIVEKIT_KEYS="devkey: secret" \
  livekit/livekit-server \
  --dev
```

Local credentials:

- **URL**: `ws://localhost:7880`
- **Key**: `devkey`
- **Secret**: `secret`

### 3. Configure OpenCode

#### Method 1: Environment Variables

```bash
export LIVEKIT_URL="wss://your-project.livekit.cloud"
export LIVEKIT_API_KEY="your-api-key"
export LIVEKIT_API_SECRET="your-api-secret"

# Optional: For better transcription
export DEEPGRAM_API_KEY="your-deepgram-key"
```

#### Method 2: Configuration File

Add to `opencode.json`:

```json
{
  "livekit": {
    "serverUrl": "wss://your-project.livekit.cloud",
    "apiKey": "your-api-key",
    "apiSecret": "your-api-secret",
    "defaultRoomName": "opencode-collaboration",
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

### 4. Verify Installation

```bash
# Check if LiveKit commands are available
opencode room --help

# Test configuration
opencode room agent start --help
```

---

## Usage Guide

### Basic Workflow

1. **Configure LiveKit** with your credentials
2. **Start an AI agent** in a room
3. **Join the room** via browser or external agent
4. **Speak naturally** - agent transcribes and assists
5. **View results** - notes, todos, and summaries

### Step-by-Step Example

#### 1. Start an AI Agent

```bash
# Interactive mode (prompts for room name)
opencode room agent start

# Or specify room directly
opencode room agent start --room team-standup
```

You'll see:

```
🤖 Starting OpenCode Room Agent

? Which room should the agent join? › team-standup

🏠 Room: team-standup
🤖 Agent: opencode-assistant
📝 Transcription: ✓
📋 Notes: ✓
✅ Todos: ✓

Connecting to room...
✅ Agent started successfully!

The agent is now listening in the room.
Press Ctrl+C to stop the agent.
```

#### 2. Join the Room

**Option A: Browser (LiveKit Meet)**

1. Go to [meet.livekit.io](https://meet.livekit.io/)
2. Enter your server URL
3. Join room: `team-standup`
4. Allow microphone access

**Option B: External Agent**

- Configure your external agent to join the same room
- The OpenCode agent will automatically discover tools

#### 3. Test Voice Interaction

Speak these phrases to test the agent:

```
"This is an important decision - we need to use TypeScript"
→ Creates note: "Decision: Use TypeScript"

"We should finish the documentation by Friday"
→ Creates todo: "finish the documentation by Friday" (Medium priority)

"Remember to deploy the changes asap!"
→ Creates todo: "deploy the changes" (High priority)
```

#### 4. View Results

The agent logs everything to console:

```
[local]: This is an important decision
📝 Note created: Decision noted (type: decision)

[local]: We should finish the documentation
✅ Todo created: finish the documentation (priority: medium)

[local]: Remember to deploy asap
✅ Todo created: deploy the changes (priority: high)
```

---

## CLI Commands

### Room Operations

```bash
# Join a room (coming soon)
opencode room join <room-name>

# Create a room (coming soon)
opencode room create <room-name>

# List available rooms (coming soon)
opencode room list

# Leave current room
opencode room leave
```

### Agent Management

```bash
# Start agent (interactive)
opencode room agent start

# Start agent with specific configuration
opencode room agent start \
  --room my-meeting \
  --name assistant \
  --transcribe \
  --notes \
  --todos

# Stop agent
opencode room agent stop

# Show agent status
opencode room agent status
```

### Agent Options

```bash
--room <name>        Room name to join
--name <name>        Agent display name
--transcribe         Enable transcription
--notes             Enable note generation
--todos             Enable todo extraction
--no-transcribe     Disable transcription
--no-notes          Disable note generation
--no-todos          Disable todo extraction
```

---

## Session Manager Integration

The LiveKit Session Manager provides seamless integration with OpenCode sessions, enabling automatic tool sharing and connection management.

### Initialization

```typescript
import { initializeLiveKit, getLiveKitSessionManager } from "@/livekit"

// Initialize with configuration
const config = {
  serverUrl: "wss://your-server.livekit.cloud",
  apiKey: "your-api-key",
  apiSecret: "your-api-secret",
  defaultRoomName: "opencode-collaboration",
}

const manager = await initializeLiveKit(config)

// Connect to room for current session
await manager.connectToRoom({
  sessionID: "session_123",
  roomName: "my-room",
  participantName: "OpenCode User",
})
```

### Audio Control

```typescript
// Enable microphone
await manager.enableMicrophone()

// Toggle microphone
const enabled = await manager.toggleMicrophone()

// Disable microphone
await manager.disableMicrophone()
```

### Connection State

```typescript
// Get current state
const state = manager.getConnectionState()
console.log({
  connected: state.connected,
  sessionID: state.sessionID,
  participantCount: state.participantCount,
  toolsExposed: state.toolsExposed,
  externalAgents: state.externalAgents,
})

// Listen for changes
manager.on("connectionStateChanged", (state) => {
  console.log("Connection state changed:", state)
})
```

### Event Handling

```typescript
manager.on("participantJoined", (participant) => {
  console.log("Participant joined:", participant.name)
  if (participant.isAgent) {
    console.log("AI Agent detected:", participant.identity)
  }
})

manager.on("participantLeft", (participant) => {
  console.log("Participant left:", participant.name)
})

manager.on("error", (error) => {
  console.error("LiveKit error:", error)
})
```

---

## Agent Collaboration

The system enables powerful collaboration between OpenCode and external agents through bidirectional tool sharing.

### How It Works

1. **Tool Discovery**: Agents announce their available tools when joining
2. **Permission System**: Tools require explicit permission before execution
3. **JSON-RPC Protocol**: Secure message format for tool requests
4. **Rate Limiting**: Prevents abuse with configurable limits

### Tool Announcement

When OpenCode connects to a room, it automatically announces its tools:

```json
{
  "type": "tool.discovery",
  "payload": {
    "agentId": "opencode",
    "tools": [
      {
        "name": "read_file",
        "description": "Read a file from disk",
        "parameters": [
          {
            "name": "path",
            "type": "string",
            "required": true,
            "description": "File path to read"
          }
        ]
      },
      {
        "name": "bash",
        "description": "Execute shell commands",
        "parameters": [
          {
            "name": "command",
            "type": "string",
            "required": true,
            "description": "Command to execute"
          }
        ]
      }
    ]
  }
}
```

### Tool Execution Flow

```
External Agent                    OpenCode
      │                              │
      ├─── tool.request ────────────→ │
      │    (read_file, {path: "..."}) │
      │                              ├─ Check permissions
      │                              ├─ Execute tool
      │                              ├─ Return result
      │ ←──── tool.response ──────────┤
      │    (file contents)            │
```

### External Tool Usage

```typescript
// Get available external tools
const externalTools = manager.getExternalTools()

// Execute tool from external agent
const result = await manager.executeExternalTool("external-agent-id", "search_web", {
  query: "OpenCode LiveKit",
})
```

### Permission Management

```typescript
// Grant permission for 1 hour
manager.grantToolPermission("agent_id", "bash", 3600000)

// Revoke permission
manager.revokeToolPermission("agent_id", "bash")

// View all permissions
const permissions = manager.getToolPermissions()
```

---

## Tool Sharing

### Available OpenCode Tools

The system exposes most OpenCode tools to external agents:

- **File Operations**: `read`, `write`, `edit`, `list`, `glob`
- **Code Analysis**: `grep`, `lsp-diagnostics`, `lsp-hover`
- **Development**: `bash`, `cc-bash`, `patch`
- **Content**: `webfetch`, `markdown`
- **Knowledge Base**: `kb-ingest`, `kb-query`, `kb-search`

### Excluded Tools

Some tools are intentionally excluded for security:

- `task` - Complex delegation might cause confusion
- `lsp-*` - Language server tools (some included)
- Internal system tools

### Tool Conversion

OpenCode tools are automatically converted to LiveKit format:

```typescript
// Original OpenCode tool
{
  id: "bash",
  description: "Execute shell commands",
  parameters: ZodSchema, // Zod validation schema
  execute: (params, context) => Promise<Result>
}

// Converted LiveKit tool
{
  name: "bash",
  description: "Execute shell commands",
  parameters: [
    {
      name: "command",
      type: "string",
      required: true,
      description: "Command to execute"
    }
  ],
  execute: (params) => Promise<string>
}
```

### Security Considerations

- **Auto-Grant**: Tools are automatically granted to external agents initially
- **Expiration**: Set time-based expiration for sensitive tools
- **Rate Limiting**: 60 requests per minute per agent
- **Validation**: All parameters are validated before execution
- **Context**: Tools execute with proper OpenCode session context

---

## Files Created/Modified

### New Files Created

```
src/livekit/
├── index.ts                    # Main export file
├── room-manager.ts            # LiveKit room connection management
├── room-agent.ts              # AI agent implementation
├── session-manager.ts         # OpenCode session integration
├── tool-bridge.ts             # Bidirectional tool sharing
├── transcription.ts           # Speech-to-text service
├── types.ts                   # Complete type definitions
├── example-usage.ts           # Usage examples and helpers
├── README.md                  # Feature overview and documentation
├── ARCHITECTURE.md            # System architecture details
├── QUICKSTART.md              # 5-minute setup guide
└── SESSION_MANAGER_README.md  # Session manager documentation
```

### Modified Files

```
src/cli/cmd/room.ts            # New CLI commands for room operations
package.json                   # Added LiveKit dependencies
```

### Dependencies Added

```json
{
  "livekit-client": "^2.5.7",
  "livekit-server-sdk": "^2.6.0"
}
```

### Configuration Schema

Extended `opencode.json` to support LiveKit configuration:

```json
{
  "livekit": {
    "serverUrl": "string",
    "apiKey": "string",
    "apiSecret": "string",
    "defaultRoomName": "string",
    "agent": {
      "autoJoin": "boolean",
      "transcribe": "boolean",
      "takeNotes": "boolean",
      "manageTodos": "boolean"
    },
    "audio": {
      "echoCancellation": "boolean",
      "noiseSuppression": "boolean",
      "autoGainControl": "boolean"
    }
  }
}
```

---

## Configuration

### Environment Variables

```bash
# Required
LIVEKIT_URL=wss://your-server.livekit.cloud
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret

# Optional
DEEPGRAM_API_KEY=your-deepgram-key    # Better transcription
OPENAI_API_KEY=your-openai-key        # AI responses
```

### Configuration File Options

```json
{
  "livekit": {
    "serverUrl": "wss://your-server.livekit.cloud",
    "apiKey": "your-api-key",
    "apiSecret": "your-api-secret",
    "defaultRoomName": "opencode-room",

    "agent": {
      "autoJoin": false, // Auto-join rooms on session start
      "transcribe": true, // Enable transcription
      "takeNotes": true, // Generate notes
      "manageTodos": true, // Extract todos
      "answerQuestions": false, // Respond to questions
      "executeTools": true // Allow tool execution
    },

    "audio": {
      "echoCancellation": true, // Audio echo cancellation
      "noiseSuppression": true, // Noise suppression
      "autoGainControl": true, // Automatic gain control
      "sampleRate": 48000, // Audio sample rate
      "channelCount": 1 // Audio channels (mono)
    },

    "transcription": {
      "provider": "browser", // browser | deepgram | openai
      "language": "en-US", // Speech recognition language
      "interimResults": true, // Show interim transcription
      "continuousMode": true // Continuous speech recognition
    },

    "tools": {
      "autoGrant": true, // Auto-grant tool permissions
      "defaultExpiration": 3600000, // 1 hour default expiration
      "rateLimit": 60, // Requests per minute
      "excludeTools": [
        // Tools to never expose
        "task",
        "invalid"
      ]
    }
  }
}
```

---

## Troubleshooting

### Common Issues

#### 1. "LiveKit configuration missing!"

**Problem**: No LiveKit credentials configured.

**Solution**: Set environment variables or add to `opencode.json`:

```bash
export LIVEKIT_URL="wss://your-server.livekit.cloud"
export LIVEKIT_API_KEY="your-api-key"
export LIVEKIT_API_SECRET="your-api-secret"
```

#### 2. "Failed to connect to LiveKit room"

**Problem**: Invalid credentials or network issues.

**Solutions**:

1. Verify server URL format: `wss://domain` or `ws://localhost:port`
2. Check API key and secret are correct
3. Test network connectivity to LiveKit server
4. Verify LiveKit server is running and accessible

#### 3. "Web Speech API not supported"

**Problem**: Browser doesn't support Web Speech API.

**Solutions**:

1. Use Chrome or Edge (best support)
2. Safari has partial support
3. Configure Deepgram for better transcription:
   ```bash
   export DEEPGRAM_API_KEY="your-deepgram-key"
   ```

#### 4. No transcription detected

**Problem**: Microphone not working or permissions denied.

**Solutions**:

1. Check browser microphone permissions
2. Ensure `--transcribe` flag is set
3. Test microphone in browser settings
4. Try different audio input device

#### 5. Agent not creating notes/todos

**Problem**: Speech patterns not matching detection rules.

**Solutions**:

1. Use specific trigger phrases:
   - **Notes**: "important", "remember", "note that", "decision"
   - **Todos**: "need to", "should", "must", "todo:"
2. Check that `--notes` and `--todos` flags are enabled
3. Speak clearly for better transcription accuracy

#### 6. External tools not working

**Problem**: Tool discovery or execution failing.

**Solutions**:

1. Check external agent is properly announcing tools
2. Verify JSON-RPC 2.0 message format
3. Check tool permissions: `manager.getToolPermissions()`
4. Monitor rate limiting (60 requests/minute)

#### 7. "Tool execution timeout"

**Problem**: Tool took longer than 30 seconds.

**Solutions**:

1. Optimize tool execution time
2. Break complex operations into smaller steps
3. Check tool implementation for hanging operations

### Debug Logging

Enable debug logging to troubleshoot issues:

```typescript
import { Log } from "@/util/log"

// Enable debug logging
const log = Log.create({ service: "livekit-debug" })
log.info("debugging LiveKit integration")

// Monitor connection state
setInterval(() => {
  const state = manager.getConnectionState()
  console.log("LiveKit state:", state)
}, 5000)
```

### Testing Configuration

```bash
# Test LiveKit connection
opencode room agent start --room test-room

# Check available tools
opencode room agent status

# Monitor logs during connection
opencode room agent start --room test --verbose
```

---

## Examples

### 1. Team Meeting Assistant

```bash
# Start agent for team standup
opencode room agent start \
  --room daily-standup \
  --name standup-bot \
  --transcribe \
  --notes \
  --todos

# Agent will:
# - Transcribe entire meeting
# - Note important decisions
# - Extract action items
# - Track who said what
```

**Example conversation:**

```
[alice]: "Important decision - we're switching to React 18"
→ Note: "Decision: Switching to React 18" (speaker: alice)

[bob]: "I need to update the docs by EOD"
→ Todo: "update the docs by EOD" (assignee: bob, priority: medium)

[charlie]: "Critical bug in production, need to fix asap"
→ Todo: "fix critical bug in production" (assignee: charlie, priority: high)
```

### 2. Voice Coding Session

```bash
# Start agent for voice coding
opencode room agent start \
  --room coding-session \
  --name code-assistant

# Use voice commands:
# "Important: Use dependency injection pattern"
# "Remember to add unit tests"
# "Need to refactor the auth module"
```

### 3. Multi-Agent Collaboration

```bash
# Start OpenCode agent
opencode room agent start --room multi-agent-room

# External agent joins and can:
# - Use OpenCode tools (read files, run bash commands)
# - Share its own tools (web search, data analysis)
# - Collaborate on development tasks
```

**Tool sharing example:**

```javascript
// External agent uses OpenCode tools
const fileContent = await useOpenCodeTool("read_file", {
  path: "/src/index.ts",
})

// OpenCode uses external agent tools
const searchResults = await manager.executeExternalTool("search-agent", "web_search", {
  query: "React 18 migration guide",
})
```

### 4. Interview Notes

```bash
# Start agent for interview
opencode room agent start \
  --room interview-alice \
  --name interview-assistant \
  --notes

# Perfect for:
# - Recording key points
# - Tracking candidate responses
# - Generating interview summaries
```

### 5. Programming Usage in TUI

```typescript
import { initializeLiveKit, getLiveKitSessionManager } from "@/livekit"

// Initialize for current session
const config = {
  serverUrl: process.env.LIVEKIT_URL!,
  apiKey: process.env.LIVEKIT_API_KEY!,
  apiSecret: process.env.LIVEKIT_API_SECRET!,
}

const manager = await initializeLiveKit(config)

// Connect to session-specific room
await manager.connectToRoom({
  sessionID: "current-session-id",
  roomName: "opencode-session",
  participantName: "Developer",
})

// Handle voice control
const voiceEnabled = await manager.toggleMicrophone()
console.log("Voice:", voiceEnabled ? "ON" : "OFF")

// Monitor external agents
manager.on("participantJoined", (participant) => {
  if (participant.isAgent) {
    console.log("AI Agent joined:", participant.identity)

    // Show available tools
    const tools = manager.getExternalTools()
    console.log("Available tools:", tools)
  }
})
```

---

## API Reference

### RoomManager

```typescript
class RoomManager {
  // Connection
  async connect(options: RoomOptions): Promise<void>
  async disconnect(): Promise<void>
  getConnectionState(): RoomConnectionState

  // Audio control
  async enableMicrophone(): Promise<void>
  async disableMicrophone(): Promise<void>
  async setMicrophoneVolume(level: number): Promise<void>
  getMicrophoneState(): MicrophoneState

  // Participants
  getParticipants(): Participant[]
  getRemoteAudioTracks(): AudioTrack[]

  // Data channel
  async sendData(message: DataChannelMessage, participantId?: string): Promise<void>

  // Events
  on<K extends keyof RoomEvents>(event: K, handler: RoomEvents[K]): void
}
```

### SessionManager

```typescript
class LiveKitSessionManager {
  // Configuration
  async initialize(config: LiveKitConfig): Promise<void>
  getConfig(): LiveKitConfig | undefined

  // Connection
  async connectToRoom(options: {
    sessionID: string
    roomName?: string
    participantName?: string
  }): Promise<void>
  async disconnect(): Promise<void>
  getConnectionState(): SessionConnectionState
  isConnected(): boolean

  // Audio control
  async enableMicrophone(): Promise<void>
  async disableMicrophone(): Promise<void>
  async toggleMicrophone(): Promise<boolean>

  // Tool sharing
  async executeExternalTool(
    agentId: string,
    toolName: string,
    params: Record<string, any>,
  ): Promise<any>
  getExternalTools(): Map<string, Tool[]>
  grantToolPermission(agentId: string, toolName: string, expiresIn?: number): void
  revokeToolPermission(agentId: string, toolName: string): void
  getToolPermissions(): ToolPermission[]

  // Events
  on<K extends keyof SessionManagerEvents>(event: K, handler: SessionManagerEvents[K]): void
}
```

### RoomAgent

```typescript
class OpenCodeRoomAgent {
  // Room operations
  async joinRoom(): Promise<void>
  async leaveRoom(): Promise<void>
  isAgentActive(): boolean

  // Conversation processing
  async onSpeech(text: string, speaker: string): Promise<void>
  async summarizeConversation(): Promise<string>
  async generateNotes(): Promise<ConversationNote[]>
  async extractTodos(): Promise<ConversationTodo[]>
  getConversationHistory(): TranscriptionResult[]
  clearHistory(): void

  // Events
  on<K extends keyof AgentEvents>(event: K, handler: AgentEvents[K]): void
}
```

### ToolBridge

```typescript
class ToolBridge {
  // Local tools
  async exposeTools(tools: Tool[]): Promise<void>
  async exposeTool(tool: Tool): Promise<void>
  async removeTool(toolName: string): Promise<void>
  getLocalTools(): Tool[]

  // External tools
  async discoverExternalTools(): Promise<Tool[]>
  getToolsFromAgent(agentId: string): Tool[]
  getExternalAgents(): Map<string, Tool[]>
  async executeExternalTool(
    agentId: string,
    toolName: string,
    params: Record<string, any>,
  ): Promise<any>

  // Permissions
  grantPermission(agentId: string, toolName: string, expiresIn?: number): void
  revokePermission(agentId: string, toolName: string): void
  getPermissions(): ToolPermission[]

  // Cleanup
  async cleanup(): Promise<void>
}
```

### TranscriptionService

```typescript
class TranscriptionService {
  // Control
  async startTranscription(): Promise<void>
  async stopTranscription(): Promise<void>
  isActive(): boolean

  // Configuration
  setLanguage(language: string): void
  setProvider(provider: "browser" | "deepgram" | "openai"): void
  getConfig(): TranscriptionConfig

  // Events
  on<K extends keyof TranscriptionEvents>(event: K, handler: TranscriptionEvents[K]): void
}
```

---

This comprehensive documentation covers the complete LiveKit integration built for OpenCode. The system provides a robust foundation for voice-enabled AI collaboration with extensive tool sharing capabilities, making it easy for developers to interact with AI assistants and external agents through natural voice communication.
