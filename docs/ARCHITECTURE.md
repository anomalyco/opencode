# OpenWork Architecture Documentation

**Last Updated:** 2026-01-15

This document provides a comprehensive overview of the OpenWork codebase architecture for developers joining the project.

## Table of Contents

- [Project Overview](#project-overview)
- [Technology Stack](#technology-stack)
- [Repository Structure](#repository-structure)
- [Package Architecture](#package-architecture)
- [Data Flow](#data-flow)
- [Key Concepts](#key-concepts)
- [Related Documentation](#related-documentation)

---

## Project Overview

**OpenWork** is an AI-powered workspace collaboration tool for knowledge workers. It's a fork of OpenCode with extended capabilities for multi-file collaboration, file activity tracking, and team workflows. The project provides:

- **Desktop Application**: Native app built with Tauri (Rust backend + Solid.js frontend)
- **Web Application**: Browser-based interface using Solid.js
- **CLI**: Command-line interface for AI agent operations
- **Enterprise Backend**: Team collaboration features via Hono API

---

## Technology Stack

| Layer | Technology | Version |
|-------|------------|---------|
| **Frontend Framework** | Solid.js | 1.9.10 |
| **Styling** | Tailwind CSS | 4.1.11 |
| **UI Components** | @kobalte/core | 0.13.11 |
| **Desktop Runtime** | Tauri | v2 |
| **Backend Language** | Rust | 2024 Edition |
| **Frontend Language** | TypeScript | 5.8.2 |
| **Package Manager** | Bun | 1.3.5 |
| **Monorepo Tool** | Turborepo | - |
| **Bundler** | Vite | 7.1.4 |
| **API Framework** | Hono | - |
| **AI Integration** | Vercel AI SDK | - |

---

## Repository Structure

```
openwork/
├── packages/                    # Monorepo packages
│   ├── app/                     # Main web application UI
│   ├── desktop/                 # Tauri desktop application
│   ├── ui/                      # Shared UI component library
│   ├── sdk/                     # JavaScript/TypeScript SDK
│   │   └── js/                  # SDK implementation
│   ├── opencode/                # CLI and backend logic
│   ├── plugin/                  # Plugin system framework
│   ├── util/                    # Shared utilities
│   ├── web/                     # Marketing/documentation site
│   ├── enterprise/              # Enterprise backend
│   ├── identity/                # Brand assets (logos, icons)
│   ├── console/                 # Console applications (7 packages)
│   ├── docs/                    # Static documentation
│   ├── function/                # Serverless functions
│   └── slack/                   # Slack integration
├── tauri-plugin-mcp/            # Custom Tauri MCP plugin (git submodule)
├── specs/                       # Feature specifications
├── infra/                       # Infrastructure as code
├── nix/                         # Nix environment definitions
├── .github/                     # GitHub workflows
├── package.json                 # Monorepo workspace config
├── turbo.json                   # Turborepo pipeline config
├── bunfig.toml                  # Bun package manager config
└── CLAUDE.md                    # Development guidelines
```

---

## Package Architecture

### Core Application Packages

#### `packages/app` - Main Web Application
The primary UI codebase used by both desktop and web deployments.

```
packages/app/src/
├── app.tsx                 # App root with provider setup
├── entry.tsx               # Web entry point
├── pages/                  # Page-level components
│   ├── session.tsx         # Main workspace page
│   ├── layout.tsx          # Layout management
│   └── home.tsx            # Home page
├── components/             # UI components (~30 files)
│   ├── workspace-sidebar.tsx
│   ├── file-tree.tsx
│   ├── prompt-input.tsx
│   └── dialog-*.tsx        # Dialog components
├── context/                # State management (~20 providers)
│   ├── layout.tsx
│   ├── file-activity.tsx
│   ├── mcp-connectors.tsx
│   └── sdk.tsx
├── types/                  # TypeScript definitions
└── utils/                  # Utility functions
```

#### `packages/desktop` - Tauri Desktop App
Native desktop wrapper with system integration.

```
packages/desktop/
├── src/                    # TypeScript frontend
│   ├── index.tsx           # Entry point
│   ├── cli.ts
│   ├── menu.ts
│   └── updater.ts
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── lib.rs          # Main plugin integration
│   │   ├── main.rs
│   │   └── cli.rs
│   ├── Cargo.toml          # Rust dependencies
│   ├── tauri.conf.json     # Tauri configuration
│   ├── capabilities/       # Permission definitions
│   └── icons/              # App icons (dev/prod)
└── vite.config.ts
```

#### `packages/ui` - Shared Component Library
Reusable UI components, themes, and styling.

```
packages/ui/src/
├── components/             # ~86 component files
│   ├── button.tsx
│   ├── dialog.tsx
│   ├── tooltip.tsx
│   └── provider-icons/
├── context/                # UI-specific contexts
│   ├── dialog.tsx
│   ├── theme/
│   └── marked.tsx
├── theme/                  # Theme system
├── styles/                 # CSS and Tailwind
└── assets/                 # Fonts, audio, icons
```

### SDK & Backend Packages

#### `packages/sdk/js` - JavaScript SDK
Auto-generated from OpenAPI specification.

```
packages/sdk/js/src/
├── client.ts               # createOpencodeClient()
├── server.ts               # createOpencodeServer()
├── gen/                    # Generated from OpenAPI
│   ├── sdk.gen.ts          # OpencodeClient class
│   ├── client/
│   │   ├── client.gen.ts   # HTTP client
│   │   └── types.gen.ts    # Request/response types
│   └── types.gen.ts        # Schema types
└── v2/                     # Version 2 API
```

#### `packages/opencode` - CLI & Backend
Core backend logic with 38+ directories.

```
packages/opencode/src/
├── agent/                  # Agent implementations
├── provider/               # AI provider integrations
│   └── sdk/
│       └── openai-compatible/
├── mcp/                    # Model Context Protocol
├── lsp/                    # Language Server Protocol
├── server/                 # REST API server
├── session/                # Session management
├── config/                 # Configuration
├── tool/                   # Tool registry
└── permission/             # Permission management
```

### Plugin System

#### `tauri-plugin-mcp` - MCP Integration Plugin
Custom Tauri plugin enabling AI agents to interact with GUIs.

```
tauri-plugin-mcp/
├── src/                    # Rust plugin code
│   ├── lib.rs              # Plugin initialization
│   ├── tools/              # Tool handlers
│   └── platform/           # OS-specific code
├── mcp-server-ts/          # TypeScript MCP server
├── guest-js/               # JavaScript bindings
└── permissions/            # Permission definitions
```

---

## Data Flow

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Solid.js)                       │
│                  packages/app/src/context/                   │
└────────────┬────────────────────────────────────────────────┘
             │
             │ createOpencodeClient() with baseUrl
             │
┌────────────▼────────────────────────────────────────────────┐
│                  @opencode-ai/sdk (client)                   │
│  packages/sdk/js/src/gen/client/client.gen.ts               │
│  - REST HTTP calls via generated methods                     │
│  - Auto-generated from OpenAPI schema                        │
└────────────┬────────────────────────────────────────────────┘
             │
             │ HTTP/SSE
             │
┌────────────▼────────────────────────────────────────────────┐
│              Hono Server (Bun Runtime)                       │
│          packages/opencode/src/server/server.ts              │
│  - REST endpoints                                            │
│  - Session/prompt management                                 │
│  - Tool orchestration                                        │
└────────────┬────────────────────────────────────────────────┘
             │
      ┌──────┴──────────────────┬──────────────────┬─────────┐
      │                         │                  │         │
┌─────▼──────┐        ┌────────▼──────┐   ┌──────▼────┐  ┌──▼──┐
│  Providers  │        │  MCP Clients  │   │    Tools  │  │ LSP │
│ (ai-sdk)    │        │   (stdio/sse) │   │ (registry)│  │     │
└─────┬──────┘        └────────┬──────┘   └──────┬────┘  └─────┘
      │                        │                  │
      └────────────┬───────────┴──────────────────┘
                   │
         ┌─────────▼──────────┐
         │  LLM + Tools Loop  │
         │ (generateObject,   │
         │  tool.callTool)    │
         └────────────────────┘
```

### Communication Patterns

1. **HTTP/REST**: Standard request-response for CRUD operations
2. **Server-Sent Events (SSE)**: Real-time updates and streaming
3. **IPC/TCP Sockets**: MCP plugin communication
4. **Tauri Commands**: Desktop app system integration

---

## Context Provider Hierarchy

The app uses a nested provider pattern for state management. Understanding this hierarchy is critical for debugging and extending the app.

### Provider Tree (from `packages/app/src/app.tsx`)

```
MetaProvider                          # SEO/meta tags
└── Font                              # Font loading
    └── ThemeProvider                 # Theme state (@opencode-ai/ui)
        └── ErrorBoundary             # Error handling
            └── DialogProvider        # Modal dialogs (@opencode-ai/ui)
                └── MarkedProvider    # Markdown rendering
                    └── DiffComponentProvider  # Diff viewer
                        └── CodeComponentProvider  # Code highlighting
                            └── ServerProvider     # Server URL management
                                └── GlobalSDKProvider   # SDK client + event streaming
                                    └── GlobalSyncProvider  # Global state sync
                                        └── Router
                                            └── PermissionProvider  # Permission rules
                                                └── LayoutProvider    # UI state (sidebar, tabs)
                                                    └── NotificationProvider
                                                        └── CommandProvider  # Keybinds
                                                            └── Layout (page)
```

### Per-Directory Providers (from `pages/directory-layout.tsx`)

When navigating to a project directory, additional providers are layered:

```
DirectoryLayout
└── SDKProvider           # Directory-scoped SDK client
    └── SyncProvider      # Session/message sync for directory
        └── LocalProvider # Local UI state for directory
            └── FileActivityProvider   # File read/edit/create tracking
                └── McpConnectorsProvider  # MCP server configuration
                    └── [Session Page]
```

### Per-Session Providers (from route `/session/:id?`)

```
TerminalProvider          # PTY session management
└── FileProvider          # Selected file state
    └── PromptProvider    # Current prompt input
        └── Session (page component)
```

### Key Context APIs

| Context | Hook | Purpose |
|---------|------|---------|
| `ServerProvider` | `useServer()` | Server URL, health check |
| `GlobalSDKProvider` | `useGlobalSDK()` | `{ url, client, event }` - SDK client + event emitter |
| `GlobalSyncProvider` | `useGlobalSync()` | Global session/project data store |
| `LayoutProvider` | `useLayout()` | Sidebar state, tabs, file preview, terminal height |
| `SDKProvider` | `useSDK()` | Directory-scoped SDK operations |
| `SyncProvider` | `useSync()` | Session/message data for current directory |
| `FileActivityProvider` | `useFileActivity()` | Track file operations per session |
| `McpConnectorsProvider` | `useMcpConnectors()` | MCP server configuration management |

### Event Flow Pattern

```typescript
// GlobalSDKProvider sets up SSE event streaming:
const events = await sdk.global.event()
for await (const event of events.stream) {
  emitter.emit(event.directory, event.payload)  // Broadcasts to directory-specific listeners
}

// Components subscribe via:
const sdk = useSDK()
sdk.event.on("session.updated", handler)
```

---

## Key Concepts

### Sessions
A session represents a conversation context with the AI. Sessions contain:
- Message history
- File activity tracking
- Permission rules
- Summary of file changes

### MCP (Model Context Protocol)
Protocol for connecting AI models to external tools and resources:
- **Tools**: Actions the AI can execute
- **Resources**: Data sources the AI can read
- **Prompts**: Template commands

### Providers
AI model integrations supporting 18+ providers including:
- Anthropic (Claude)
- OpenAI
- Google (Gemini)
- Amazon Bedrock
- Azure OpenAI
- And more...

### Tools
Built-in capabilities available to the AI:
- `BashTool` - Command execution
- `EditTool` / `WriteTool` - File manipulation
- `GlobTool` / `GrepTool` - File search
- `ReadTool` - File reading
- `WebFetchTool` / `WebSearchTool` - Web access
- `TaskTool` - Subtask delegation
- `TodoTool` - Task tracking

---

### Console Packages (`packages/console/`)

The console packages provide enterprise/team features:

#### `packages/console/app` - Console Web Application
SolidStart-based web app for team management and administration.
- **Framework**: SolidStart with Cloudflare Workers
- **Auth**: OpenAuth integration
- **Payments**: Stripe integration

```
packages/console/app/
├── src/
│   ├── routes/           # SolidStart routes
│   ├── components/       # Console UI components
│   └── lib/              # Business logic
├── vite.config.ts
└── package.json
```

#### `packages/console/core` - Console Backend
Backend services with database and cloud integrations.
- **Database**: Drizzle ORM with PlanetScale
- **Cloud**: AWS SDK integration
- **Storage**: S3 for file storage

```
packages/console/core/
├── src/
│   ├── db/               # Drizzle schema and queries
│   ├── services/         # Business logic services
│   └── api/              # API handlers
└── package.json
```

#### Other Console Packages
| Package | Purpose |
|---------|---------|
| `console/mail` | Email service functionality |
| `console/function` | Serverless function handlers |
| `console/resource` | Resource management utilities |

---

## Related Documentation

- [CODE_CONVENTIONS.md](./CODE_CONVENTIONS.md) - Code style and conventions
- [COMPONENT_PATTERNS.md](./COMPONENT_PATTERNS.md) - Solid.js component patterns
- [SDK_API.md](./SDK_API.md) - SDK and API documentation
- [TAURI_BACKEND.md](./TAURI_BACKEND.md) - Rust backend patterns
- [DEVELOPMENT_SETUP.md](./DEVELOPMENT_SETUP.md) - Local development setup
- [TESTING.md](./TESTING.md) - Testing patterns and strategies
- [CI_CD.md](./CI_CD.md) - CI/CD pipeline documentation
- [PLUGIN_DEVELOPMENT.md](./PLUGIN_DEVELOPMENT.md) - Plugin development guide
- [CLAUDE.md](../CLAUDE.md) - Development guidelines

---

## Build & Development Commands

```bash
# Install dependencies
bun install

# Development
bun run dev                              # Root CLI
bun run --cwd packages/desktop tauri dev # Desktop app
bun run --cwd packages/app dev           # Web app

# Type checking
bun run typecheck

# Building
bun run --cwd packages/desktop tauri build  # Desktop release

# Testing
cargo test                               # Rust tests
cargo clippy                             # Rust linting
```

---

## Package Dependencies

```
@opencode-ai/app
├── @opencode-ai/ui (shared UI)
├── @opencode-ai/sdk (API client)
└── @opencode-ai/util (utilities)

@opencode-ai/desktop
├── @opencode-ai/app
├── @opencode-ai/ui
├── tauri-plugin-mcp
└── @tauri-apps/api, @tauri-apps/plugin-*

@opencode-ai/opencode (CLI)
├── @opencode-ai/sdk
├── @opencode-ai/plugin
└── 40+ AI provider SDKs

@opencode-ai/ui
├── @opencode-ai/sdk
├── @opencode-ai/util
└── solid-js, @kobalte/core, tailwindcss
```
