# Architecture

**Analysis Date:** 2026-01-19

## Pattern Overview

**Overall:** Modular Monorepo with Event-Driven Backend

**Key Characteristics:**
- TypeScript/Bun monorepo using Turborepo for build orchestration
- Event-driven architecture with pub/sub Bus system for inter-component communication
- Server-client architecture with HTTP/SSE API and SDK abstraction
- Agent-based AI interaction model with pluggable tools and providers
- Instance-scoped state management tied to project directories

## Layers

**CLI Layer:**
- Purpose: Parse commands, orchestrate workflows, provide TUI interface
- Location: `packages/opencode/src/cli/`
- Contains: Command handlers (`cmd/*.ts`), UI utilities, bootstrap logic
- Depends on: Session, Provider, Agent, Server
- Used by: End users via terminal

**Server Layer:**
- Purpose: HTTP API for external clients (web app, desktop, SDK consumers)
- Location: `packages/opencode/src/server/`
- Contains: Hono routes, SSE event streaming, OpenAPI spec generation
- Depends on: Session, Provider, Config, Bus
- Used by: Web app, Desktop app, SDK clients, CLI run command

**Session Layer:**
- Purpose: Manage AI conversation state, message processing, LLM interactions
- Location: `packages/opencode/src/session/`
- Contains: Message storage, prompt processing, retry logic, compaction, cost tracking
- Depends on: Provider, Agent, Tool, Storage, Bus
- Used by: Server routes, CLI commands

**Provider Layer:**
- Purpose: Abstract AI model providers, handle authentication, manage SDK instances
- Location: `packages/opencode/src/provider/`
- Contains: Provider registry, model definitions, SDK initialization, authentication
- Depends on: Config, Auth, Plugin
- Used by: Session, Agent

**Agent Layer:**
- Purpose: Define AI agent personas with specific permissions and capabilities
- Location: `packages/opencode/src/agent/`
- Contains: Agent definitions, permission rules, specialized prompts
- Depends on: Config, Provider, Permission
- Used by: Session processor

**Tool Layer:**
- Purpose: Executable capabilities available to AI agents
- Location: `packages/opencode/src/tool/`
- Contains: Built-in tools (bash, read, write, edit, glob, grep, etc.), tool registry
- Depends on: Permission, Config, File utilities
- Used by: Session processor (via LLM tool calls)

**Storage Layer:**
- Purpose: Persist session data, messages, parts to filesystem
- Location: `packages/opencode/src/storage/`
- Contains: JSON file storage, migrations, locking
- Depends on: Global paths, Filesystem utilities
- Used by: Session, Project

**Bus Layer:**
- Purpose: Event pub/sub for real-time updates across components
- Location: `packages/opencode/src/bus/`
- Contains: Event definitions, subscriptions, global bus relay
- Depends on: Instance state
- Used by: Server (SSE streaming), Session (state changes), all major components

**UI Packages:**
- Purpose: Frontend rendering for web and desktop clients
- Location: `packages/app/`, `packages/ui/`, `packages/desktop/`
- Contains: SolidJS components, themes, context providers
- Depends on: SDK (`@opencode-ai/sdk`)
- Used by: Web server, Desktop Tauri app

## Data Flow

**User Prompt Flow:**

1. User submits prompt via CLI/Web/Desktop client
2. Server receives request at `/session/prompt` route
3. Session.create or Session.get retrieves/creates session state
4. SessionPrompt builds LLM messages from history and context
5. LLM.stream sends request to provider SDK
6. SessionProcessor handles stream events (text, tool calls, reasoning)
7. Tool calls execute via ToolRegistry, results fed back to LLM
8. Bus publishes events (message.part.updated, session.idle)
9. Server streams events to clients via SSE
10. Session and message parts persisted to Storage

**State Management:**
- Instance-scoped state via `Instance.state()` factory
- State keyed by project directory, disposed on instance cleanup
- Global state managed separately in `Global.Path.data`
- Configuration layered: remote -> global -> project (highest priority)

## Key Abstractions

**Instance:**
- Purpose: Scoped execution context for a project directory
- Examples: `packages/opencode/src/project/instance.ts`
- Pattern: AsyncLocalStorage context with state factory

**Session:**
- Purpose: Conversation container with messages, cost tracking, sharing
- Examples: `packages/opencode/src/session/index.ts`
- Pattern: Zod schema with CRUD operations, event publishing

**Provider:**
- Purpose: AI service abstraction (Anthropic, OpenAI, etc.)
- Examples: `packages/opencode/src/provider/provider.ts`
- Pattern: Registry with lazy SDK initialization, custom loaders per provider

**Tool:**
- Purpose: Executable agent capability with schema validation
- Examples: `packages/opencode/src/tool/tool.ts`, `packages/opencode/src/tool/bash.ts`
- Pattern: Factory function returning init/execute, Zod parameters

**Agent:**
- Purpose: AI persona with prompt, permissions, model selection
- Examples: `packages/opencode/src/agent/agent.ts`
- Pattern: Configuration-driven with merge semantics

**MessageV2:**
- Purpose: Conversation message with typed parts (text, tool, reasoning)
- Examples: `packages/opencode/src/session/message-v2.ts`
- Pattern: Discriminated union for part types

## Entry Points

**CLI Entry:**
- Location: `packages/opencode/src/index.ts`
- Triggers: `opencode` binary execution
- Responsibilities: Parse args via yargs, dispatch to command handlers

**Server Entry:**
- Location: `packages/opencode/src/server/server.ts`
- Triggers: `opencode serve`, `opencode web`, direct API calls
- Responsibilities: Route HTTP requests, stream SSE events, serve web app

**Web App Entry:**
- Location: `packages/app/src/entry.tsx`
- Triggers: Vite dev server, production build
- Responsibilities: Mount SolidJS app, establish SDK connection

**Desktop Entry:**
- Location: `packages/desktop/` (Tauri app)
- Triggers: Native app launch
- Responsibilities: Embed web app in native window, manage local server

## Error Handling

**Strategy:** Named errors with typed data, propagation over swallowing

**Patterns:**
- `NamedError.create()` for domain-specific errors with Zod schemas
- Server catches NamedError and returns structured JSON response
- CLI formats errors for terminal display via `FormatError`
- Retry logic in SessionProcessor for transient failures (rate limits)
- Session.Event.Error published for UI notification

## Cross-Cutting Concerns

**Logging:** `Log.create({ service })` factory, writes to file at `Global.Path.data/logs/`

**Validation:** Zod schemas throughout, used for config, API, storage, events

**Authentication:** `Auth` namespace manages provider credentials (API keys, OAuth tokens)

**Configuration:** Layered config system (remote -> global -> project) in `packages/opencode/src/config/config.ts`

**Permissions:** Rule-based permission system in `packages/opencode/src/permission/next.ts`, patterns match tool/file operations

---

*Architecture analysis: 2026-01-19*
