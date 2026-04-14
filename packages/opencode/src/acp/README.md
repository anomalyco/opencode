# ACP (Agent Client Protocol) Implementation

This directory contains a clean, protocol-compliant implementation of the [Agent Client Protocol](https://agentclientprotocol.com/) for opencode.

## Architecture

The implementation follows a clean separation of concerns:

### Core Components

- **`agent.ts`** - Implements the `Agent` interface from `@agentclientprotocol/sdk`
  - Handles initialization and capability negotiation
  - Manages session lifecycle (`session/new`, `session/load`)
  - Processes prompts and returns responses
  - Properly implements ACP protocol v1

- **`client.ts`** - Implements the `Client` interface for client-side capabilities
  - File operations (`readTextFile`, `writeTextFile`)
  - Permission requests (auto-approves for now)
  - Terminal support (stub implementation)

- **`session.ts`** - Session state management
  - Creates and tracks ACP sessions
  - Maps ACP sessions to internal opencode sessions
  - Maintains working directory context
  - Handles MCP server configurations

- **`server.ts`** - ACP server startup and lifecycle
  - Sets up JSON-RPC over stdio using the official library
  - Manages graceful shutdown on SIGTERM/SIGINT
  - Provides Instance context for the agent

- **`types.ts`** - Type definitions for internal use

## Usage

### Command Line

```bash
# Start the ACP server in the current directory
opencode acp

# Start in a specific directory
opencode acp --cwd /path/to/project
```

### Programmatic

```typescript
import { ACPServer } from "./acp/server"

await ACPServer.start()
```

### Integration with Zed

Add to your Zed configuration (`~/.config/zed/settings.json`):

```json
{
  "agent_servers": {
    "OpenCode": {
      "command": "opencode",
      "args": ["acp"]
    }
  }
}
```

## Protocol Compliance

This implementation follows the ACP specification v1:

✅ **Initialization**

- Proper `initialize` request/response with protocol version negotiation
- Capability advertisement (`agentCapabilities`)
- Authentication support (stub)

✅ **Session Management**

- `session/new` - Create new conversation sessions
- `session/load` - Resume existing sessions (basic support)
- Working directory context (`cwd`)
- MCP server configuration support

✅ **Prompting**

- `session/prompt` - Process user messages
- Content block handling (text, resources)
- Response with stop reasons

✅ **Client Capabilities**

- File read/write operations
- Permission requests
- Terminal support (stub for future)

## Current Limitations

### Not Yet Implemented

1. **Streaming Responses** - Currently returns complete responses instead of streaming via `session/update` notifications
2. **Tool Call Reporting** - Doesn't report tool execution progress
3. **Session Modes** - No mode switching support yet
4. **Authentication** - No actual auth implementation
5. **Terminal Support** - Placeholder only
6. **Session Persistence** - `session/load` doesn't restore actual conversation history

### Future Enhancements

- **Real-time Streaming**: Implement `session/update` notifications for progressive responses
- **Tool Call Visibility**: Report tool executions as they happen
- **Session Persistence**: Save and restore full conversation history
- **Mode Support**: Implement different operational modes (ask, code, etc.)
- **Enhanced Permissions**: More sophisticated permission handling
- **Terminal Integration**: Full terminal support via opencode's bash tool

## Testing

```bash
# Run ACP tests
bun test test/acp.test.ts

# Test manually with stdio
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}' | opencode acp
```

## Design Decisions

### Why the Official Library?

We use `@agentclientprotocol/sdk` instead of implementing JSON-RPC ourselves because:

- Ensures protocol compliance
- Handles edge cases and future protocol versions
- Reduces maintenance burden
- Works with other ACP clients automatically

### Clean Architecture

Each component has a single responsibility:

- **Agent** = Protocol interface
- **Client** = Client-side operations
- **Session** = State management
- **Server** = Lifecycle and I/O

This makes the codebase maintainable and testable.

### Mapping to OpenCode

ACP sessions map cleanly to opencode's internal session model:

- ACP `session/new` → creates internal Session
- ACP `session/prompt` → uses SessionPrompt.prompt()
- Working directory context preserved per-session
- Tool execution uses existing ToolRegistry

## References

- [ACP Specification](https://agentclientprotocol.com/)
- [TypeScript Library](https://github.com/agentclientprotocol/typescript-sdk)
- [Protocol Examples](https://github.com/agentclientprotocol/typescript-sdk/tree/main/src/examples)
