# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenCode is an open-source AI coding agent with TUI, desktop (Tauri), and web interfaces. It's provider-agnostic, supporting Claude, OpenAI, Google, and local models. Built with a client/server architecture enabling remote operation.

## Development Commands

```bash
# Install dependencies
bun install

# Run OpenCode (TUI in packages/opencode directory)
bun dev
bun dev <directory>          # Run against different directory
bun dev .                    # Run in repo root

# Type checking
bun turbo typecheck

# Tests (run from package directory, NOT root)
bun test --cwd packages/opencode

# Build standalone executable
./packages/opencode/script/build.ts --single

# Regenerate SDK after API/SDK changes
./script/generate.ts

# Web app development
bun run --cwd packages/app dev

# Desktop app development
bun run --cwd packages/desktop tauri dev
```

## Repository Structure

**Bun monorepo** with Turbo for build orchestration. Default branch is `dev`.

### Core Packages
- `packages/opencode` - Main CLI, server, and TUI (SolidJS + opentui)
- `packages/app` - Shared web UI components (SolidJS)
- `packages/ui` - UI component library (Kobalte, Tailwind, Shiki)
- `packages/desktop` - Native desktop app (Tauri v2)
- `packages/plugin` - Plugin API for extensions
- `packages/sdk/js` - JavaScript SDK

### OpenCode Core Architecture (`packages/opencode/src/`)
- `agent/` - Agent definitions and execution
- `cli/` - CLI commands (includes `cmd/tui/` for terminal UI)
- `server/` - HTTP server and API
- `provider/` - AI provider integrations
- `lsp/` - Language Server Protocol support
- `mcp/` - Model Context Protocol
- `tool/` - Tool implementations
- `session/` - Conversation session management
- `config/` - Configuration handling
- `permission/` - Permission system
- `shell/` - Shell command execution
- `skill/` - Skill system
- `storage/` - Data persistence

### Infrastructure
- `infra/` - SST/IaC (Cloudflare, PlanetScale, Stripe)
- `packages/console/` - Admin dashboard (app, core, function, mail)
- `packages/enterprise/` - Enterprise features

## Code Style

- **No destructuring**: Use `obj.a` instead of `const { a } = obj`
- **No `let`**: Prefer `const` with ternary or early returns
- **No `else`**: Use early returns
- **No `try/catch`**: Prefer `.catch()`
- **Single-word names**: When possible
- **Bun APIs**: Use `Bun.file()` and similar helpers
- **No `any`**: Use precise types
- **Prettier**: No semicolons, 120 char line width

## Key Technical Details

- **Runtime**: Bun 1.3.5+
- **TypeScript**: 5.8.2, type checking via `tsgo --noEmit`
- **UI Framework**: SolidJS
- **API Framework**: Hono
- **ORM**: Drizzle
- **AI SDK**: Vercel AI SDK (multi-provider)
- **Orchestrator**: Hierarchical 3-tier agent system (planner → workers → reviewer)

## Important Notes

- Always use parallel tool calls when operations are independent
- Never run `bun test` from repo root
- Run `./script/generate.ts` after modifying API or SDK
- PRs must reference an existing issue
- UI/core features require design review before implementation
