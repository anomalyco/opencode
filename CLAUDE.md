# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenCode is an open-source AI-powered coding agent, similar to Claude Code but provider-agnostic. It supports multiple LLM providers (Anthropic, OpenAI, Google, Azure, local models) and features a TUI built with SolidJS, LSP support, and client/server architecture.

## Development Commands

```bash
# Install and run development server
bun install
bun dev                     # Run in packages/opencode directory
bun dev <directory>         # Run against a specific directory
bun dev .                   # Run against repo root

# Type checking
bun run typecheck           # Single package
bun turbo typecheck         # All packages

# Testing (per-package, not from root)
cd packages/opencode && bun test

# Build standalone executable
./packages/opencode/script/build.ts --single
# Output: ./packages/opencode/dist/opencode-<platform>/bin/opencode

# Regenerate SDK after API changes
./script/generate.ts
# Or for JS SDK specifically:
./packages/sdk/js/script/build.ts

# Web app development
bun run --cwd packages/app dev              # http://localhost:5173

# Desktop app (requires Tauri/Rust)
bun run --cwd packages/desktop tauri dev    # Native + web server
bun run --cwd packages/desktop dev          # Web only (port 1420)
bun run --cwd packages/desktop tauri build  # Production build
```

## Architecture

**Monorepo Structure** (Bun workspaces + Turbo):

| Package | Purpose |
|---------|---------|
| `packages/opencode` | Core CLI, server, business logic |
| `packages/app` | Shared web UI components (SolidJS + Vite) |
| `packages/desktop` | Native desktop app (Tauri wrapper) |
| `packages/ui` | Shared component library (Kobalte + Tailwind) |
| `packages/console/app` | Console dashboard (Solid Start) |
| `packages/console/core` | Backend services (Hono + DrizzleORM) |
| `packages/sdk/js` | JavaScript SDK |
| `packages/plugin` | Plugin system API |

**Key Directories in `packages/opencode/src`**:
- `cli/cmd/tui/` - Terminal UI (SolidJS + opentui)
- `agent/` - Agent logic and state
- `provider/` - AI provider implementations
- `server/` - Server mode
- `mcp/` - Model Context Protocol integration
- `lsp/` - Language Server Protocol support

**Default branch**: `dev`

## Code Style

- Keep logic in single functions unless reusable
- Avoid destructuring: use `obj.a` instead of `const { a } = obj`
- Avoid `try/catch` - prefer `.catch()`
- Avoid `else` statements
- Avoid `any` type
- Avoid `let` - use immutable patterns
- Prefer single-word variable names when descriptive
- Use Bun APIs (e.g., `Bun.file()`) when applicable

## Built-in Agents

- **build** - Default agent with full access for development
- **plan** - Read-only agent for analysis (denies edits, asks before bash)
- **general** - Subagent for complex tasks, invoked with `@general`

Switch agents with `Tab` key in TUI.

## Debugging

```bash
# Debug with inspector
bun run --inspect=ws://localhost:6499/ dev

# Debug server separately
bun run --inspect=ws://localhost:6499/ ./src/index.ts serve --port 4096
opencode attach http://localhost:4096

# Debug TUI
bun run --inspect=ws://localhost:6499/ --conditions=browser ./src/index.ts

# Use spawn for breakpoints in server code
bun dev spawn
```

Use `--inspect-wait` or `--inspect-brk` for different breakpoint behaviors.

## PR Guidelines

- All PRs must reference an existing issue (`Fixes #123`)
- UI/core feature changes require design review with core team
- PR titles follow conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`
- Optional scope: `feat(app):`, `fix(desktop):`
- Include screenshots/videos for UI changes
- Explain verification steps for logic changes
