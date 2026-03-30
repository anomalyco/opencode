# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenCode is an open-source AI coding agent built with Bun. It uses a client/server architecture where the TUI (terminal user interface) is one of multiple possible clients. The project is a monorepo using Bun workspaces with Turbo for build orchestration.

## Development Commands

### Running OpenCode
```bash
bun dev                      # Start OpenCode TUI (default: packages/opencode dir)
bun dev <directory>          # Start OpenCode TUI in specific directory
bun dev .                    # Start OpenCode TUI in repo root
bun dev serve                # Start headless API server (port 4096)
bun dev web                  # Start server + open web interface
```

### Running Related Packages
```bash
bun run --cwd packages/app dev              # Web UI dev server
bun run --cwd packages/desktop tauri dev    # Desktop app (Tauri)
bun run --cwd packages/desktop dev          # Desktop web server only
bun run --cwd packages/console/app dev      # Console app dev
bun run --cwd packages/storybook storybook   # Storybook
```

### Building & Testing
```bash
bun typecheck                    # Run typecheck across all packages (Turbo)
bun run --cwd packages/opencode typecheck   # Typecheck single package
bun run --cwd packages/opencode test       # Run opencode tests (not from root)
bun run --cwd packages/app test            # Run app tests

# Build standalone executable
./packages/opencode/script/build.ts --single
./packages/opencode/dist/opencode-<platform>/bin/opencode
```

### Database
```bash
bun run --cwd packages/opencode db         # Drizzle Kit CLI
```

## Architecture

### Package Structure
- **packages/opencode** - Core CLI, server, TUI, LSP support, agent logic
- **packages/opencode/src/cli/cmd/tui/** - TUI frontend (SolidJS + opentui)
- **packages/app** - Shared web UI components (SolidJS, Vite)
- **packages/desktop** - Tauri wrapper for desktop app
- **packages/console** - Backend API server (Hono + Nitro)
  - `packages/console/app` - Main console web app
  - `packages/console/core` - Core business logic
  - `packages/console/function` - Serverless functions
  - `packages/console/mail` - Email templates
  - `packages/console/resource` - Resource management
- **packages/enterprise** - Cloudflare Workers deployment target
- **packages/plugin** - Plugin system (`@opencode-ai/plugin`)
- **packages/sdk/js** - JavaScript SDK
- **packages/ui** - Shared UI components
- **packages/util** - Shared utilities

### Key Technologies
- **Runtime:** Bun 1.3+
- **UI Framework:** SolidJS with SolidStart
- **Backend:** Hono + Nitro
- **Database:** Drizzle ORM with SQLite (Bun) or Cloudflare D1
- **TUI:** opentui + SolidJS
- **Desktop:** Tauri v2
- **Effect:** Effect library for typed errors and concurrent programming
- **AI SDK:** AI SDK by Vercel (provider-agnostic)

### OpenCode Source Structure (packages/opencode/src)
- `cli/` - CLI commands and TUI code
- `server/` - API server implementation
- `agent/` - Agent logic
- `lsp/` - LSP server implementation
- `provider/` - AI provider integrations
- `storage/` - Database and storage
- `mcp/` - MCP (Model Context Protocol) server
- `acp/` - Agent Client Protocol

## Important Notes

### Branch
- Default branch is `dev`, not `main`. Use `dev` for diffs and PRs.

### Style Guide (AGENTS.md)
The style guide in AGENTS.md is **mandatory** for agent-written code:
- **Single-word names** are mandatory by default for locals/params/helpers
- Avoid `try`/`catch` where possible
- Avoid `any` type
- Avoid unnecessary destructuring
- Avoid `else` statements; prefer early returns
- Prefer `const` over `let`
- Use Bun APIs when available (`Bun.file()`)
- Use functional array methods (flatMap, filter, map) over for loops
- Use snake_case for Drizzle field names

### Testing
- Tests cannot run from repo root; run from package directories
- Avoid mocks; test actual implementation
- Use `bun test` (Bun's built-in test runner)

### Type Checking
- Always use `tsgo` (not `tsc`) for type checking
- Run from package directories: `bun run --cwd packages/<pkg> typecheck`

### SDK Generation
After modifying server code, regenerate SDK:
```bash
./packages/sdk/js/script/build.ts
```
