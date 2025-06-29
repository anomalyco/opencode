# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenCode is an AI coding agent built for the terminal. It's a monorepo project with three main packages:
- `packages/opencode/` - Core TypeScript logic (Bun runtime)
- `packages/tui/` - Terminal UI in Go (Bubble Tea framework)
- `packages/web/` - Documentation site (Astro)

## Commands

### Development
```bash
# Install dependencies
bun install

# Run the development server
bun run packages/opencode/src/index.ts

# Run type checking across all packages
bun run typecheck

# Format code with Prettier (triggered automatically on .json file edits)
bun run prettier <file>
```

### Testing
```bash
# Run tests (using Bun's built-in test runner)
cd packages/opencode && bun test

# Run a specific test file
bun test packages/opencode/test/tool/<test-file>.test.ts
```

### Documentation Site
```bash
# Start documentation dev server
cd packages/web && bun run dev

# Build documentation
cd packages/web && bun run build
```

## Architecture

The project follows a client-server architecture:

```
Terminal UI (Go) ← HTTP/WebSocket → Core Logic (TypeScript) ← → AI Providers
```

### Key Directories

**Core Logic (`packages/opencode/src/`)**
- `auth/` - Authentication providers (Anthropic, AWS Bedrock, etc.)
- `cli/` - CLI command implementations
- `tool/` - AI tool implementations (file operations, search, web)
- `server/` - API server using Hono framework
- `provider/` - AI provider integrations

**Terminal UI (`packages/tui/`)**
- `cmd/` - Main entry point
- `internal/` - UI components using Bubble Tea

### Important Patterns

1. **Tool System**: Tools are implemented in `packages/opencode/src/tool/` with a consistent interface. Each tool has its own file and follows the pattern in existing tools.

2. **Provider Integration**: AI providers are abstracted in `packages/opencode/src/provider/`. Adding a new provider involves implementing the provider interface.

3. **Configuration**: The project uses `opencode.json` for configuration, which supports experimental hooks for file editing and session completion.

4. **Rules System**: Similar to CLAUDE.md, the project uses AGENTS.md files for project-specific instructions. Global rules can be placed in `~/.config/opencode/AGENTS.md`.

## Development Requirements

- **Bun** - JavaScript runtime and package manager
- **Go 1.24.x** - For building the terminal UI
- **TypeScript** - Core logic is written in TypeScript

## Code Style

- **Prettier** configuration: No semicolons (`"semi": false`)
- **TypeScript**: Extends Bun's TypeScript config
- Git hooks run typecheck on pre-push

## Testing Approach

- Tests are located in `packages/opencode/test/`
- Use Bun's built-in test runner
- Snapshot testing is used for tool implementations
- Test files follow the pattern `*.test.ts`

## API Development

When modifying TypeScript API endpoints in `packages/opencode/src/server/server.ts`, coordinate with the team for Stainless SDK generation for clients.

## Infrastructure

The project uses SST v3 for infrastructure deployment to Cloudflare. Configuration is in `sst.config.ts`.