# OpenCode Codebase Analysis: From CLI to Webapp

## Executive Summary

OpenCode is an open-source AI coding agent platform built with a **modular, multi-tier architecture** designed for extensibility. It currently operates as a CLI tool with a Terminal UI (TUI) frontend, but the codebase is already structured to support multiple clients including web applications. The architecture uses a **server/client separation pattern** with a Hono-based HTTP API that can be consumed by different frontends.

---

## 1. Project Structure and Architecture

### 1.1 Monorepo Organization

The project is organized as a Bun monorepo with the following key packages:

```
packages/
├── opencode/          # Core CLI logic and server (113 TypeScript files)
├── tui/               # Terminal UI (Go-based, separate from core)
├── sdk/
│   └── js/            # TypeScript SDK for integrations
├── script/            # Build and utility scripts
├── plugin/            # Plugin API definitions
├── console/
│   ├── app/           # SolidJS web app (existing, Vercel/Astro-based)
│   ├── core/          # Backend services (database, auth, workspaces)
│   └── function/      # Serverless functions
├── web/               # Documentation/landing page (Astro)
├── desktop/           # Desktop application (Tauri-based)
└── identity/          # Identity/auth package
```

### 1.2 Technology Stack

**Runtime & Language:**
- Bun 1.3.0 (modern JavaScript runtime)
- TypeScript 5.8.2 (primary language)
- Go (for TUI package)

**Core Frameworks:**
- **Hono** (4.7.10) - lightweight web framework for HTTP API
- **AI SDK** (5.0.8) - Vercel's AI framework for LLM integration
- **Zod** (4.1.8) - TypeScript-first schema validation

**UI/Frontend (Existing):**
- **SolidJS** (1.9.9) - reactive framework
- **Solid Start** - SolidJS fullstack framework
- **Tailwind CSS** (4.1.11) - utility-first styling
- **Kobalte** (0.13.11) - accessible component library

**Storage & Persistence:**
- File-based JSON storage (in `~/.opencode/storage/`)
- SQLite (in console backend)
- Local filesystem for project state

**Cloud/Deployment:**
- SST (Serverless Stack) 3.17.19 - AWS infrastructure
- Cloudflare Workers
- OpenAuth for authentication

---

## 2. How the CLI Currently Works

### 2.1 Entry Point and Command Structure

**Main Entry:** `/packages/opencode/src/index.ts`

The CLI uses **Yargs** for command parsing:

```typescript
// CLI commands available:
- opencode run [message]      # Main command to interact with agent
- opencode tui                # Launch terminal UI
- opencode serve              # Start headless API server
- opencode auth               # Authentication management
- opencode agent              # Agent management
- opencode generate           # Code generation
- opencode mcp                # Model Context Protocol
- opencode acp                # Agent Client Protocol
- opencode debug              # Debugging utilities
- opencode upgrade            # Self-upgrade
- opencode models             # Model management
- opencode stats              # Session statistics
- opencode export             # Export sessions
- opencode github             # GitHub integration
```

### 2.2 Core Components

#### A. Session Management (`/src/session/`)
- **Session.ts** - Session creation, persistence, fork/continue logic
- **SessionPrompt.ts** - Main AI interaction loop with streaming
- **MessageV2.ts** - Message structure and types
- **SessionCompaction.ts** - Context window management
- **SessionLock.ts** - Concurrency control
- **SessionRevert.ts** - Undo/revert functionality

#### B. Agent System (`/src/agent/`)
- Multiple agents: `general`, `plan`, `build`, `custom`
- Agent modes: `primary`, `subagent`, `all`
- Permission system per agent
- Tool enablement/disablement
- Custom model support per agent

#### C. Tool Registry (`/src/tool/`)
Built-in tools include:
- `bash` - Execute shell commands
- `edit` - Edit files with structured modifications
- `read` - Read file contents
- `write` - Create/overwrite files
- `glob` - File pattern matching
- `grep` - Code searching
- `ls` - Directory listing
- `patch` - Apply diffs
- `todo` - Todo management
- `webfetch` - Web content fetching
- Custom tools via plugins

#### D. Provider System (`/src/provider/`)
- Multi-provider support: Anthropic, OpenAI, Google, AWS Bedrock, Azure
- Model registry with pricing/capabilities
- Custom model loaders
- Provider-specific options and configurations

#### E. Configuration (`/src/config/`)
- **opencode.json/jsonc** - Project config files
- **Global config** - User-level settings
- **Permission system** - Fine-grained access control
- **Agent definitions** - Custom agents
- **Plugin loading**

#### F. File System & Storage (`/src/file/`, `/src/storage/`)
- **Storage.ts** - JSON-based file storage
- **Ripgrep wrapper** - Fast code searching
- **LSP support** - Language server integration
- **Watch system** - File monitoring

#### G. Bus/Event System (`/src/bus/`)
- Event-driven architecture
- Session events (created, updated, deleted, error)
- Server connection events
- Type-safe event publishing/subscription

### 2.3 Main Execution Flow

1. **CLI Initialization** → Parse arguments with Yargs
2. **Logging Setup** → Initialize logger with configurable levels
3. **Authentication** → Check and validate API keys
4. **Project Detection** → Identify project root and configuration
5. **Command Execution** → Route to appropriate command handler
6. **Session Management** → Create/continue session
7. **Agent Loop** → 
   - Take user input
   - Format with context (files, conversation history)
   - Call LLM via AI SDK
   - Execute tool calls
   - Stream results
   - Update session state
8. **Persistence** → Save session to storage

---

## 3. Server Architecture (Already HTTP-Ready)

### 3.1 The Serve Command

The `serve` command (`/src/cli/cmd/serve.ts`) already exposes a **Hono HTTP API**:

```bash
opencode serve --port 3000 --hostname 0.0.0.0
```

### 3.2 API Routes (from `/src/server/server.ts`)

The server implements a comprehensive REST API:

**Session Management:**
- `GET /session` - List all sessions
- `POST /session` - Create session
- `GET /session/:id` - Get session details
- `PATCH /session/:id` - Update session
- `DELETE /session/:id` - Delete session
- `GET /session/:id/message` - List messages in session

**Message/Interaction:**
- `POST /session/:id/message` - Send message
- `GET /session/:id/message/:msgId` - Get message details
- `GET /session/:id/message/:msgId/part` - Get message parts (streaming)
- `POST /session/:id/message/:msgId/part` - Execute tool
- `DELETE /session/:id/message/:msgId` - Delete message

**Configuration:**
- `GET /config` - Get configuration
- `PATCH /config` - Update configuration
- `GET /path` - Get current paths

**Tools & Agents:**
- `GET /experimental/tool/ids` - List all tools
- `GET /experimental/tool` - Get tool definitions
- `POST /experimental/agent/:id` - Invoke agent

**Project Operations:**
- `GET /project` - Project info
- `GET /project/file` - Read file
- `POST /project/file` - Write file
- `DELETE /project/file` - Delete file
- `GET /project/search` - Search files

**Streaming:**
- Server-Sent Events (SSE) for real-time updates
- WebSocket support for TUI

### 3.3 API Response Format

The API uses Zod-validated responses with consistent error handling:

```typescript
{
  success: boolean,
  data: T | null,
  errors?: Record<string, any>[],
}
```

---

## 4. Technologies and Frameworks

### 4.1 Frontend Technologies (Current)

**Console App** (existing web interface):
- SolidJS + Solid Start framework
- Tailwind CSS for styling
- Kobalte for components
- OpenAuth for authentication
- Deployed on Cloudflare

### 4.2 Backend Technologies

**Core Processing:**
- Vercel's `ai` SDK (handles 10+ LLM providers)
- Tree-sitter (code parsing)
- Ripgrep (fast searching)
- Diff/patch libraries

**API:**
- Hono (lightweight framework)
- Zod (schema validation & OpenAPI generation)
- hono-openapi (automatic OpenAPI docs)

**Storage:**
- File system (SQLite in progress)
- Git integration (worktree detection)

**DevOps:**
- SST (AWS Infrastructure as Code)
- Turbo (monorepo task orchestration)
- Bun build system

---

## 5. Core Functionality for Webapp Integration

### 5.1 Key APIs to Expose

The following modules are self-contained and ready for API consumption:

1. **Session Management**
   - Create/continue/fork sessions
   - Persist to storage
   - List and retrieve session history

2. **Message Processing**
   - Send messages to agent
   - Stream responses
   - Execute tools server-side
   - Handle tool results

3. **Agent Selection**
   - List available agents
   - Get agent configurations
   - Invoke specific agents

4. **Tool Execution**
   - File operations (read, write, edit, glob, grep)
   - Code execution (bash)
   - Web operations
   - Custom tools via plugins

5. **Configuration Management**
   - Get/update user config
   - Manage API keys
   - Control permissions
   - Define custom agents

6. **Project Management**
   - Detect project information
   - Read/write files
   - Search codebase
   - Get git status

### 5.2 Critical Modules for API

These modules are **already decoupled** from CLI and can be used by webapp:

- `Session` - Core session logic
- `SessionPrompt` - AI interaction loop
- `Agent` - Agent management
- `Provider` - Model/provider abstraction
- `ToolRegistry` - Tool discovery and execution
- `Storage` - Data persistence
- `Config` - Configuration management
- `Permission` - Access control
- `Bus` - Event system

---

## 6. Main CLI Logic Location

### 6.1 Directory Structure

```
/packages/opencode/src/
├── index.ts                    # Entry point (CLI setup)
├── cli/
│   ├── cmd/
│   │   ├── run.ts             # Main interaction command
│   │   ├── serve.ts           # Server startup
│   │   ├── tui.ts             # TUI launcher
│   │   ├── auth.ts            # Auth management
│   │   └── ...other commands
│   ├── bootstrap.ts           # CLI initialization
│   ├── error.ts               # Error formatting
│   └── ui.ts                  # CLI output formatting
├── server/
│   ├── server.ts              # Hono app & API routes
│   ├── tui.ts                 # TUI-specific routes
│   └── project.ts             # Project routes
├── session/
│   ├── index.ts               # Session CRUD
│   ├── prompt.ts              # Agent loop (critical)
│   ├── message-v2.ts          # Message types
│   └── ...other session logic
├── agent/
│   └── agent.ts               # Agent definitions
├── tool/
│   ├── registry.ts            # Tool management
│   ├── bash.ts                # Individual tools
│   ├── edit.ts
│   ├── read.ts
│   └── ...others
├── provider/
│   └── provider.ts            # LLM provider abstraction
├── config/
│   └── config.ts              # Configuration loading
├── storage/
│   └── storage.ts             # Persistence layer
└── ...other modules
```

### 6.2 Key Files for Webapp Integration

**Must understand/expose:**
1. `/src/session/prompt.ts` - Contains the main agentic loop
2. `/src/tool/registry.ts` - Tool discovery and execution
3. `/src/server/server.ts` - API definitions
4. `/src/agent/agent.ts` - Agent configuration
5. `/src/provider/provider.ts` - Model management

**Core logic (mostly pure functions, minimal CLI deps):**
- Session creation and message handling
- Tool execution
- Provider/model selection
- Configuration management

---

## 7. Conversion Path: CLI to Webapp

### 7.1 What Already Exists

1. **REST API Server** - Already implemented in `Server.ts` via Hono
2. **Headless Mode** - `opencode serve` already runs without TUI
3. **Event System** - Bus-based pub/sub ready for WebSocket
4. **Configuration API** - Config exposed via HTTP

### 7.2 What Needs to be Built/Extended

1. **Webapp Frontend**
   - Modern UI (SolidJS already used in console)
   - Session/message display
   - File editor integration
   - Real-time streaming updates (SSE/WebSocket)

2. **Authentication**
   - OpenAuth integration
   - API key management in webapp

3. **Project Browser**
   - File tree navigation
   - Real-time file monitoring

4. **Enhanced API**
   - WebSocket for bidirectional communication
   - File streaming for large files
   - Event subscriptions

### 7.3 Recommended Architecture

```
Client (Webapp)
    ↓ HTTP/WebSocket
Hono Server + Session/Agent Logic
    ↓
Tool Execution Layer (bash, edit, read, etc.)
    ↓
File System / LLM APIs
```

The **core logic (sessions, agents, tools) remains unchanged** - only the interface changes from CLI/TUI to Web UI.

---

## 8. Key Dependencies and Frameworks

### Runtime Dependencies
- `ai` (5.0.8) - LLM provider integration
- `hono` (4.7.10) - Web server
- `zod` (4.1.8) - Schema validation
- `tree-sitter` - Code parsing
- `@parcel/watcher` - File monitoring
- `yargs` - CLI argument parsing (can be removed for webapp-only)

### Development
- `turbo` - Build orchestration
- TypeScript, Bun
- Prettier for formatting

### Optional (already integrated)
- Model Context Protocol (MCP)
- Agent Client Protocol (ACP)
- LSP support for IDE features

---

## 9. Configuration and Extensibility

### 9.1 User Configuration

Located in:
- `~/.opencode/config.json` (global)
- `opencode.json/jsonc` in project root
- `.opencode/` directory in project

Supports:
- Custom agents with system prompts
- Tool enablement/disablement
- Permission rules
- Model selection
- Plugin loading

### 9.2 Plugin System

Custom tools can be added via:
- `tool/*.ts` files in config directories
- Plugin packages
- Exported `ToolDefinition` interface

---

## Summary

**OpenCode is architecturally well-suited for webapp conversion:**

1. **Existing HTTP API** - Already has Hono server with REST endpoints
2. **Decoupled Logic** - Core session/agent/tool logic is CLI-agnostic
3. **Storage Abstraction** - File-based storage can persist webapp state
4. **Event System** - Bus-based architecture can integrate with WebSocket
5. **Modular Tools** - Tool registry allows any frontend to execute same tools
6. **Provider Abstraction** - Multi-provider LLM support is framework-independent

**Conversion Strategy:**
- Keep `/src/server/server.ts` as-is (it's already the API)
- Enhance with WebSocket support for real-time updates
- Build new SolidJS/React frontend instead of TUI
- Extend authentication for web users
- Add project/file browsing UI
- Stream tool outputs to frontend

**Expected Effort:** Most core logic is already extracted; main work is building the web frontend and enhancing real-time communication capabilities.
