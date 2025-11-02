# LiveKit Session Manager

The LiveKit Session Manager integrates LiveKit real-time voice collaboration with OpenCode sessions, providing seamless tool sharing and audio communication between users and external AI agents.

## Features

- **Session-bound LiveKit connections** - Connect to voice rooms tied to specific OpenCode sessions
- **Tool sharing** - Expose OpenCode tools to external agents and execute their tools
- **Audio control** - Microphone enable/disable/toggle functionality
- **Participant management** - Track room participants and identify external agents
- **Event system** - React to connection changes, participant events, and tool executions
- **Singleton pattern** - Single manager instance for the entire application

## Quick Start

### 1. Initialize LiveKit

```typescript
import { initializeLiveKit } from "@/livekit"

const config = {
  serverUrl: "wss://your-livekit-server.com",
  apiKey: "your-api-key",
  apiSecret: "your-api-secret",
  defaultRoomName: "opencode-collaboration",
}

const manager = await initializeLiveKit(config)
```

### 2. Connect to a Room

```typescript
await manager.connectToRoom({
  sessionID: "session_123",
  roomName: "opencode-session-123", // optional
  participantName: "OpenCode User", // optional
})
```

### 3. Listen for Events

```typescript
manager.on("connectionStateChanged", (state) => {
  console.log("Connected:", state.connected)
  console.log("Participants:", state.participantCount)
  console.log("Tools exposed:", state.toolsExposed)
})

manager.on("participantJoined", (participant) => {
  if (participant.isAgent) {
    console.log("AI Agent joined:", participant.identity)
  }
})
```

### 4. Control Audio

```typescript
// Enable microphone
await manager.enableMicrophone()

// Toggle microphone
const enabled = await manager.toggleMicrophone()

// Disable microphone
await manager.disableMicrophone()
```

## Tool Sharing

### Exposing OpenCode Tools

Tools are automatically exposed when connecting to a room. The session manager:

1. Fetches available tools from OpenCode's tool registry
2. Converts them to LiveKit format
3. Announces them to the room via data channels
4. Handles execution requests from external agents

### Executing External Tools

```typescript
// Get tools from external agents
const externalTools = manager.getExternalTools()

// Execute a tool from an agent
const result = await manager.executeExternalTool("agent_id", "tool_name", { param1: "value1" })
```

### Managing Permissions

```typescript
// Grant permission for an agent to use a tool
manager.grantToolPermission("agent_id", "bash", 3600000) // 1 hour

// Revoke permission
manager.revokeToolPermission("agent_id", "bash")

// View all permissions
const permissions = manager.getToolPermissions()
```

## Integration with TUI

### Example Voice Controller

```typescript
import { LiveKitVoiceController } from "@/livekit/example-usage"

const voiceController = new LiveKitVoiceController()

// In your TUI component
const handleToggleVoice = async () => {
  const enabled = await voiceController.toggleVoice()
  updateUI({ voiceEnabled: enabled })
}

const connectionState = voiceController.getConnectionState()
const participants = voiceController.getParticipants()
```

### State Management

```typescript
// Get current state
const state = manager.getConnectionState()
// {
//   connected: true,
//   sessionID: "session_123",
//   participantCount: 3,
//   audioEnabled: true,
//   toolsExposed: 15,
//   externalAgents: 2
// }

// Check connection status
if (manager.isConnected()) {
  // Show voice controls
}
```

## Architecture

### Components

- **LiveKitSessionManager** - Main singleton manager class
- **RoomManager** - Handles LiveKit room connections and audio
- **ToolBridge** - Manages bidirectional tool sharing
- **Event System** - Coordinates events between components

### Tool Conversion

OpenCode tools are converted to LiveKit format:

```typescript
// OpenCode tool
{
  id: "bash",
  description: "Execute shell commands",
  parameters: ZodSchema,
  execute: (params, context) => Promise<Result>
}

// LiveKit tool
{
  name: "bash",
  description: "Execute shell commands",
  parameters: [
    { name: "command", type: "string", required: true }
  ],
  execute: (params) => Promise<string>
}
```

### Session Integration

- Automatically touches OpenCode sessions on connection
- Listens for session updates/deletions
- Refreshes tool exposure when sessions change
- Disconnects when current session is deleted

## Configuration

### Environment Variables

```bash
LIVEKIT_SERVER_URL=wss://your-livekit-server.com
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret
```

### Programmatic Config

```typescript
interface LiveKitConfig {
  serverUrl: string
  apiKey: string
  apiSecret: string
  defaultRoomName?: string
}
```

## Error Handling

```typescript
try {
  await manager.connectToRoom({ sessionID: "123" })
} catch (error) {
  if (error.message.includes("not configured")) {
    // Initialize LiveKit first
  } else if (error.message.includes("connection already in progress")) {
    // Wait for current connection attempt
  }
}

manager.on("error", (error) => {
  console.error("LiveKit error:", error)
  // Handle connection failures, audio errors, etc.
})
```

## Cleanup

```typescript
// Disconnect from current room
await manager.disconnect()

// Full shutdown (in app cleanup)
import { shutdownLiveKit } from "@/livekit/example-usage"
await shutdownLiveKit()
```

## Security Considerations

### Tool Permissions

- Tools are automatically granted to external agents initially
- Implement permission UI for user control
- Set expiration times for sensitive tools
- Monitor tool execution in logs

### Rate Limiting

- Built into ToolBridge (60 requests/minute per agent)
- Prevents abuse from external agents
- Configurable limits

### Data Channel Security

- All tool communication uses JSON-RPC 2.0 protocol
- Messages are validated before processing
- Errors are safely handled and logged

## Troubleshooting

### Common Issues

1. **"LiveKit not configured"** - Call `initializeLiveKit()` first
2. **Connection failures** - Check server URL and credentials
3. **No audio** - Verify microphone permissions
4. **Tools not exposed** - Check tool registry and session state
5. **External tools fail** - Verify agent connectivity and permissions

### Debug Logging

```typescript
import { Log } from "@/util/log"

// Enable debug logging for LiveKit components
const log = Log.create({ service: "livekit-debug" })
log.info("debugging LiveKit session manager")
```

### Connection State Monitoring

```typescript
setInterval(() => {
  const state = manager.getConnectionState()
  console.log("LiveKit state:", state)
}, 5000)
```

## Examples

See `example-usage.ts` for complete examples of:

- Session initialization
- Voice control
- Tool management
- TUI integration
- Error handling
- Cleanup procedures
