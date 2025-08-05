# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Environment

**Package Manager**: Bun (`bun@1.2.14`)
**Runtime**: Node.js with TypeScript
**Architecture**: Monorepo with workspaces

## Common Commands

```bash
# Install dependencies
bun install

# Run opencode in development mode
bun run dev

# Type checking across all packages
bun run typecheck

# Run opencode from source
bun run packages/opencode/src/index.ts

# Generate stainless SDK (requires team access)
./scripts/stainless
```

## Project Architecture

This is a monorepo containing multiple packages:

### Core Packages
- **`packages/opencode/`** - Main CLI application and core logic
- **`packages/tui/`** - Go-based terminal user interface
- **`packages/function/`** - Serverless functions for API/gateway
- **`packages/web/`** - Documentation website (Astro)
- **`packages/sdk/`** - SDKs for Go and JavaScript clients
- **`packages/plugin/`** - Plugin system

### Key Architecture Components

**CLI Structure (`packages/opencode/src/`):**
- `cli/` - Command line interface and bootstrapping
- `server/` - HTTP server and TUI integration
- `session/` - Chat session management and prompts
- `tool/` - Tool implementations (bash, edit, grep, etc.)
- `provider/` - LLM provider integrations
- `auth/` - Authentication (Anthropic, GitHub Copilot)
- `lsp/` - Language Server Protocol integration
- `mcp/` - Model Context Protocol support

**Client-Server Architecture:**
- opencode runs as a server process
- TUI (Go) connects as a client
- API endpoints defined in `server/server.ts`
- WebSocket communication for real-time updates

**Tool System:**
- Each tool has a `.ts` implementation and `.txt` description
- Tools are registered in `tool/registry.ts`
- Supports bash, file operations, LSP integration, etc.

**Session Management:**
- Messages stored with versioning (v2 format)
- Different modes: normal, plan, agent
- System prompts in `session/prompt/`

## Development Notes

**API Changes**: After modifying TypeScript API endpoints in `packages/opencode/src/server/server.ts`, contact the opencode team to regenerate the stainless SDK.

**Testing**: Test files located in `packages/opencode/test/` with Bun test runner.

**Infrastructure**: Uses SST for deployment to Cloudflare (see `sst.config.ts`).

**Git Hooks**: Postinstall script sets up git hooks via `script/hooks`.

## Code Conventions

- TypeScript with strict typing
- Prettier formatting (semi: false, printWidth: 120)
- Workspace dependencies use `workspace:*` or `catalog:` references
- Tool descriptions use `.txt` files alongside `.ts` implementations