# Forge Architecture

This document describes the technical architecture of Forge, a TUI for ACP agents with local server infrastructure.

## Overview

Forge is built on three main pillars:

1. **TUI (Terminal User Interface)** - User-facing terminal interface
2. **HTTP Server** - Local server for session management and configuration
3. **ACP Client** - Agent subprocess management and communication

## Component Details

### 1. TUI (Terminal User Interface)

**Location:** `packages/forge/src/cli/cmd/tui/`

**Technology Stack:**
- **Solid.js** - Reactive UI framework (not React)
- **OpenTUI** - Terminal rendering library
- Inspired by `sst/opentui` (reference implementation at `/Users/patrickerichsen/Git/opentui`)

**Key Features:**
- Interactive terminal-based interface
- Real-time agent interaction
- Session timeline visualization
- Themeable UI (multiple built-in themes)

**Entry Point:** `packages/forge/src/cli/cmd/tui/index.tsx`

### 2. HTTP Server

**Location:** `packages/forge/src/server/`

**Technology Stack:**
- **Hono** - Fast, lightweight HTTP framework
- Express-like API design

**Responsibilities:**
- Session persistence and management
- Authentication handling
- Configuration storage and sync
- API endpoints for TUI communication

**Why a server?**
While Forge is primarily a TUI application, the server architecture enables:
- Persistent session storage
- Multi-client support (future: mobile app driving desktop instance)
- Centralized configuration management
- Authentication flow handling

### 3. ACP Client

**Location:** `packages/forge/src/acp/`

**Technology Stack:**
- Agent Client Protocol (ACP) implementation
- Subprocess management for agent processes
- Message translation and orchestration

**Key Modules:**
- `agent.ts` - Agent lifecycle management
- `session.ts` - ACP session handling
- `orchestrator.ts` - Multi-agent coordination
- `translator.ts` - Message translation between formats
- `types.ts` - TypeScript type definitions

**Responsibilities:**
- Spawning and managing ACP agent subprocesses
- Handling agent communication protocol
- Translating between TUI messages and ACP protocol
- Managing agent state and lifecycle

### 4. MCP Integration

**Location:** `packages/forge/src/mcp/`

**Why MCP in Forge?**
ACP agents use MCP (Model Context Protocol) servers as their tool interface. MCP provides:
- Standardized tool definitions
- Resource access (files, APIs, databases)
- Extensible tool ecosystem

**How it works:**
1. Forge discovers available MCP servers
2. ACP agents connect to these servers
3. Agents use MCP tools to perform actions
4. Results flow back through the ACP protocol

## Data Flow

```
User Input (TUI)
    ↓
HTTP Server (session management)
    ↓
ACP Client (agent orchestration)
    ↓
ACP Agent Process
    ↓
MCP Servers (tools)
    ↓
System Actions
```

## SDK Communication Layer

**Location:** `packages/sdk/js/`

The SDK (`@forge/sdk`) provides:
- TypeScript client for HTTP server communication
- Type-safe API methods
- Real-time event subscriptions
- Session state synchronization

**Used By:**
- TUI components (for server communication)
- Future clients (mobile app, web interface)

## Key Design Decisions

### Why Solid.js instead of React?

Forge inherits Solid.js from the OpenCode/OpenTUI architecture. Key benefits:
- Fine-grained reactivity (better performance)
- No virtual DOM overhead
- Smaller bundle size
- Better suited for terminal rendering

Reference: The local clone at `/Users/patrickerichsen/Git/opentui` demonstrates Solid.js usage patterns.

### Why Local HTTP Server?

While the current TUI could theoretically work standalone, the server architecture:
1. Enables future multi-client scenarios
2. Provides clean separation of concerns
3. Allows for persistent state management
4. Facilitates authentication flows

### Why Keep MCP?

ACP agents rely on MCP for their tool ecosystem. MCP provides:
- Standardized tool protocol
- Large ecosystem of existing servers
- Extensibility for custom tools

## File Organization

```
packages/forge/src/
├── acp/           # ACP client implementation
├── cli/           # CLI commands and TUI
│   └── cmd/
│       └── tui/   # Solid.js TUI application
├── mcp/           # MCP integration
├── server/        # Hono HTTP server
├── session/       # Session management
├── config/        # Configuration handling
├── storage/       # Data persistence
└── util/          # Shared utilities
```

## Development Workflow

1. **Install dependencies:** `bun install`
2. **Run development server:** `bun run dev`
3. **TUI starts** and connects to HTTP server
4. **Server manages** session state and config
5. **ACP client** spawns agent processes as needed
6. **MCP servers** provide tools to agents

## Future Architecture Considerations

### Potential Multi-Client Support

The server architecture enables scenarios like:
- Mobile app UI driving desktop Forge instance
- Web dashboard for remote monitoring
- Multiple TUI clients to same server

### Configuration Management

- Global config: `~/.forge/` directory
- Project config: `forge.json` / `forge.jsonc`
- Server stores and syncs configuration across clients

### Session Persistence

- Sessions stored on server
- Survive TUI restarts
- Enable session replay/review

## Testing

- **ACP Client Tests:** `packages/forge/test/acp/`
- **Run tests:** `bun test`

## Related Documentation

- **Agent Client Protocol (ACP):** https://agentclientprotocol.com
- **Model Context Protocol (MCP):** https://modelcontextprotocol.io
- **OpenTUI Reference:** `/Users/patrickerichsen/Git/opentui`

---

For questions about specific implementations, refer to the source code in the relevant directories listed above.
