# Architecture Overview

OpenCode follows a client-server architecture with clear separation of concerns. The system is designed to be modular, extensible, and support multiple client types.

## High-Level Architecture

```
┌─────────────────┐    HTTP/WebSocket   ┌─────────────────┐
│   CLI Client    │ ◄──────────────────►│   Server API    │
└─────────────────┘                     └─────────────────┘
                                        │
┌─────────────────┐    HTTP/WebSocket   │  ┌─────────────┐
│   TUI Client    │ ◄──────────────────►│  │   Storage   │
└─────────────────┘                     │  └─────────────┘
                                        │
┌─────────────────┐    HTTP/WebSocket   │  ┌─────────────┐
│   Web Client    │ ◄──────────────────►│  │   Event     │
└─────────────────┘                     │  │    Bus      │
                                        │  └─────────────┘
                                        │
                                        │  ┌─────────────┐
                                        └─►│ AI Providers│
                                           └─────────────┘
```

## Core Components

### 1. Server (`packages/opencode/src/server/`)

The server is the central component that:

- Provides REST API and WebSocket endpoints
- Manages session lifecycle
- Handles AI provider communication
- Coordinates tool execution
- Manages permissions and security

**Key Files:**

- `server.ts` - Main HTTP server using Hono framework
- `tui.ts` - TUI-specific routes
- `project.ts` - Project management routes

### 2. Session Management (`packages/opencode/src/session/`)

Sessions are the core abstraction that:

- Store conversation history
- Maintain context across interactions
- Support forking and reverting
- Handle message processing and AI responses

**Key Files:**

- `index.ts` - Session CRUD operations
- `prompt.ts` - Message processing and AI interaction
- `message-v2.ts` - Message structure and handling
- `system.ts` - System prompt management

### 3. Agent System (`packages/opencode/src/agent/`)

Agents define AI behavior and capabilities:

- **build**: Full-featured agent for development
- **plan**: Read-only agent for analysis
- **general**: Subagent for complex tasks
- Custom agents with specific permissions and tools

**Key Files:**

- `agent.ts` - Agent definitions and configuration
- `generate.txt` - Agent generation prompt

### 4. Tool System (`packages/opencode/src/tool/`)

Tools provide AI capabilities:

- File operations (read, write, edit, glob, grep)
- Shell execution (bash)
- Web access (websearch, webfetch)
- LSP integration for code intelligence
- Task management (todo)

**Key Files:**

- `tool.ts` - Tool interface definition
- `registry.ts` - Tool registration and discovery
- Individual tool files (e.g., `read.ts`, `bash.ts`)

### 5. Client Interfaces

#### CLI (`packages/opencode/src/cli/`)

Command-line interface for:

- Running commands and prompts
- Managing sessions
- Configuration
- Authentication

#### TUI (`packages/opencode/src/cli/cmd/tui/`)

Terminal User Interface for:

- Interactive chat sessions
- Real-time streaming responses
- Keyboard shortcuts and navigation
- Theme support

#### Web (`packages/web/`)

Web-based interface for:

- Documentation
- Session sharing
- Public showcase

#### Console (`packages/console/`)

Management console for:

- Enterprise features
- User management
- Billing and usage
- Workspace management

## Data Flow

### 1. User Interaction Flow

```
User Input → CLI/TUI → HTTP Request → Server → Session → AI Provider → Tool Execution → Response → Client
```

### 2. Session Creation Flow

```
CLI Command → Server → Session Store → Event Bus → Client Notification
```

### 3. Tool Execution Flow

```
AI Request → Tool Registry → Tool Execution → Permission Check → Result → AI Provider
```

### 4. Real-time Communication

```
Client ↔ WebSocket ↔ Event Bus ↔ All Connected Clients
```

## Key Design Patterns

### 1. Event-Driven Architecture

- Components communicate via event bus
- Real-time updates across all clients
- Loose coupling between components

### 2. Plugin Architecture

- Tools are pluggable modules
- AI providers are swappable
- Custom agents can be added

### 3. Storage Abstraction

- File-based storage for local development
- Cloud storage for enterprise
- Configurable backends

### 4. Permission System

- Granular permissions per agent
- Tool-level access control
- User confirmation for dangerous operations

## Technology Stack

### Backend

- **Runtime**: Bun (JavaScript/TypeScript)
- **Framework**: Hono (HTTP server)
- **Storage**: File system + Cloud providers
- **AI Integration**: Vercel AI SDK

### Frontend

- **TUI**: SolidJS + OpenTUI
- **Web**: Astro + SolidJS
- **Console**: SolidJS + Kobalte

### Infrastructure

- **Deployment**: SST (Serverless Stack)
- **Platform**: Cloudflare Workers
- **Database**: Cloudflare D1/SQLite

## Configuration System

Configuration is hierarchical:

1. Default values in code
2. Project-level config files
3. User-level config
4. Environment variables
5. Command-line arguments

## Security Model

### 1. Authentication

- API keys for AI providers
- OAuth for enterprise features
- Session-based authentication

### 2. Permissions

- Agent-level permissions
- Tool access control
- Command whitelisting for plan agent

### 3. Sandboxing

- Tool execution in controlled environment
- File system access restrictions
- Network access controls

## Extensibility Points

### 1. Custom Tools

- Implement `Tool.Info` interface
- Register in tool registry
- Define parameters and execution

### 2. Custom Agents

- Define agent configuration
- Set permissions and tools
- Custom system prompts

### 3. AI Providers

- Implement provider interface
- Add to provider registry
- Handle authentication

### 4. Plugins

- Hook into system events
- Extend functionality
- Custom integrations

This architecture enables OpenCode to be flexible, extensible, and maintainable while providing a consistent experience across different client types.
