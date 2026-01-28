# Architecture

**Analysis Date:** 2026-01-27

## Pattern Overview

**Overall:** Monorepo with multi-package architecture, client-server separation, and event-driven state management

**Key Characteristics:**

- Monorepo workspace structure using Bun workspaces
- Core CLI/Server package (`opencode`) provides local AI agent capabilities
- Web frontend (`app`) connects to local server via SDK
- Console web application (`console`) provides cloud-based workspace management
- Instance-scoped state management per project directory
- Event bus for real-time updates via SSE streaming
- Plugin system for extensibility
- Multiple protocol support (ACP, MCP, custom REST API)

## Layers

**CLI Layer:**

- Purpose: Command-line interface and entry point for opencode
- Location: `packages/opencode/src/cli/`
- Contains: Command handlers (acp, mcp, serve, web, run, etc.), bootstrap logic
- Depends on: Server, Session, Config, Provider
- Used by: End users via `opencode` binary

**Server Layer:**

- Purpose: HTTP API server built on Hono framework
- Location: `packages/opencode/src/server/`
- Contains: Route handlers, middleware (auth, CSRF, CORS), SSE streaming, WebSocket support
- Depends on: Session, Project, Provider, Tool, Bus
- Used by: Web frontend (`app`), Desktop app, CLI commands

**Session Layer:**

- Purpose: Manages AI conversation sessions, message history, and LLM interactions
- Location: `packages/opencode/src/session/`
- Contains: Session creation/management, message processing, LLM streaming, prompt building, tool execution orchestration
- Depends on: Provider, Tool, Storage, Bus, Permission
- Used by: Server routes, CLI commands

**Provider Layer:**

- Purpose: Abstracts LLM provider integrations (OpenAI, Anthropic, Google, etc.)
- Location: `packages/opencode/src/provider/`
- Contains: Provider implementations, model management, API client wrappers
- Depends on: Config, Auth
- Used by: Session processor

**Tool Layer:**

- Purpose: Executable capabilities available to AI agents
- Location: `packages/opencode/src/tool/`
- Contains: Built-in tools (bash, read, write, edit, glob, grep, codesearch, etc.), tool registry
- Depends on: Permission, Config, File utilities
- Used by: Session processor (via LLM tool calls)

**Project Layer:**

- Purpose: Manages project context, VCS integration, and instance lifecycle
- Location: `packages/opencode/src/project/`
- Contains: Project detection, git integration, instance state management, directory context
- Depends on: Global paths, Filesystem utilities
- Used by: Server middleware, Session, Tool execution

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

**Frontend Layer:**

- Purpose: Web UI built with SolidJS
- Location: `packages/app/`
- Contains: React-like components, context providers, session management UI
- Depends on: SDK (`@opencode-ai/sdk`)
- Used by: Web browser clients

**Console Layer:**

- Purpose: Cloud-based workspace management and billing
- Location: `packages/console/`
- Contains: SolidStart app, database models, auth flows, billing integration
- Depends on: Database (PlanetScale), Auth API, Stripe
- Used by: Web users managing workspaces

**SDK Layer:**

- Purpose: Type-safe client library for opencode API
- Location: `packages/sdk/js/`
- Contains: Generated OpenAPI client, server types
- Depends on: OpenAPI spec
- Used by: Frontend (`app`), CLI TUI, external integrations

**Infrastructure Layer:**

- Purpose: Cloud deployment configuration using SST
- Location: `infra/`
- Contains: Cloudflare Workers, PlanetScale database, S3 buckets, secrets
- Depends on: SST framework
- Used by: Production deployments

## Data Flow

**User Prompt Flow:**

1. User submits prompt via CLI/Web/Desktop client
2. Client SDK (`@opencode-ai/sdk`) sends POST to `/session/prompt` endpoint
3. Server middleware (`packages/opencode/src/server/server.ts`) extracts directory from query/header
4. Instance middleware creates/retrieves project instance via `Instance.provide()`
5. Session route handler (`packages/opencode/src/server/routes/session.ts`) receives request
6. `Session.create()` or `Session.get()` retrieves/creates session state
7. `SessionPrompt.build()` constructs LLM messages from history and context
8. `LLM.stream()` sends request to provider SDK (`@ai-sdk/*`)
9. `SessionProcessor.handleStream()` processes stream events (text, tool calls, reasoning)
10. Tool calls execute via `ToolRegistry.execute()`, results fed back to LLM
11. Bus publishes events (`message.part.updated`, `session.status`)
12. Server streams events to clients via SSE (`/session/[id]/events`)
13. Session and message parts persisted to Storage via `Storage.write()`

**State Management:**

- Instance-scoped state via `Instance.state()` factory (`packages/opencode/src/project/instance.ts`)
- State keyed by project directory, disposed on instance cleanup
- Global state managed separately in `Global.Path.data` (`packages/opencode/src/global/index.ts`)
- Configuration layered: remote -> global -> project (highest priority) (`packages/opencode/src/config/config.ts`)

**Event Flow:**

- Components publish events via `Bus.publish()` (`packages/opencode/src/bus/`)
- Global bus relay forwards events across instance boundaries
- Server subscribes to bus events and streams via SSE
- Frontend connects to SSE endpoint and updates UI reactively

**Authentication Flow:**

- Console: OAuth (GitHub/Google) via `packages/console/function/src/auth.ts`
- Local server: Optional password auth via `Flag.OPENCODE_SERVER_PASSWORD`
- User sessions: In-memory storage in `packages/opencode/src/session/user-session.ts`
- Broker auth: Rust-based broker (`packages/opencode-broker/`) handles system-level auth

## Key Abstractions

**Instance:**

- Purpose: Provides project-scoped context and state isolation
- Examples: `packages/opencode/src/project/instance.ts`
- Pattern: Context-based dependency injection per directory

**Session:**

- Purpose: Represents an AI conversation with history and state
- Examples: `packages/opencode/src/session/index.ts`
- Pattern: Immutable updates via `update()` function, persisted to Storage

**Provider:**

- Purpose: Abstracts LLM API differences behind common interface
- Examples: `packages/opencode/src/provider/provider.ts`
- Pattern: Factory pattern with model enumeration and streaming support

**Tool:**

- Purpose: Executable function that AI can call during conversation
- Examples: `packages/opencode/src/tool/registry.ts`
- Pattern: Registry pattern with permission checks and result serialization

**Bus:**

- Purpose: Decoupled event system for component communication
- Examples: `packages/opencode/src/bus/bus.ts`
- Pattern: Event emitter with typed events and global relay

## Entry Points

**CLI Entry:**

- Location: `packages/opencode/src/index.ts`
- Triggers: `opencode` command execution
- Responsibilities: Parse arguments, initialize logging, route to command handlers

**Server Entry:**

- Location: `packages/opencode/src/server/server.ts` (`Server.listen()`)
- Triggers: `opencode serve` command or programmatic `Server.listen()`
- Responsibilities: Start HTTP server, register routes, handle SSE connections

**Web App Entry:**

- Location: `packages/app/src/entry.tsx`
- Triggers: Browser navigation to app
- Responsibilities: Initialize SolidJS app, setup routing, connect to local server

**Console Entry:**

- Location: `packages/console/app/src/entry-server.tsx`, `entry-client.tsx`
- Triggers: HTTP request to console domain
- Responsibilities: Server-side rendering, auth checks, route handling

**ACP Server Entry:**

- Location: `packages/opencode/src/cli/cmd/acp.ts`
- Triggers: `opencode acp` command
- Responsibilities: Start JSON-RPC server over stdio for Agent Client Protocol

## Error Handling

**Strategy:** Named error types with structured error objects

**Patterns:**

- `NamedError` base class (`@opencode-ai/util/error`) for all application errors
- Server error middleware converts errors to JSON responses (`packages/opencode/src/server/server.ts`)
- Storage errors (`Storage.NotFoundError`) map to 404 status codes
- Provider errors (`Provider.ModelNotFoundError`) map to 400 status codes
- Unknown errors wrapped in `NamedError.Unknown` with stack traces

## Cross-Cutting Concerns

**Logging:** Structured logging via `Log` utility (`packages/opencode/src/util/log.ts`), writes to file and optionally stderr

**Validation:** Zod schemas for all API inputs (`packages/opencode/src/server/routes/`), OpenAPI spec generation via `hono-openapi`

**Authentication:** Middleware-based (`packages/opencode/src/server/middleware/auth.ts`), optional password auth for local server

**Permission:** Permission system (`packages/opencode/src/permission/`) controls tool execution and file access

**Configuration:** Layered config system (`packages/opencode/src/config/config.ts`) with remote, global, and project-level overrides

---

_Architecture analysis: 2026-01-27_
