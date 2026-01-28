# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenCode is an open-source AI coding agent with a TUI, web UI, and desktop app. It supports multiple LLM providers and uses a client/server architecture. The default branch is `dev`.

## Commands

### Development
```bash
bun install                  # Install dependencies
bun dev                      # Run TUI (targets packages/opencode dir by default)
bun dev <directory>          # Run TUI against a specific directory
bun dev .                    # Run TUI against repo root
bun dev serve                # Start headless API server (port 4096)
bun dev serve --port 8080    # Start server on custom port
bun dev web                  # Start server + web interface
```

### Web/Desktop App Development
```bash
# First start the API server (bun dev serve), then:
bun run --cwd packages/app dev          # Web app dev server (localhost:5173)
bun run --cwd packages/desktop tauri dev # Desktop app (requires Rust/Tauri)
```

### Type Checking and Tests
```bash
bun turbo typecheck                      # Typecheck all packages
bun test --cwd packages/opencode         # Run core tests
bun run --cwd packages/app test          # Run app e2e tests (Playwright)
```

### Code Generation
```bash
./script/generate.ts         # Regenerate SDK and related files after API/SDK changes
./packages/sdk/js/script/build.ts  # Regenerate JavaScript SDK
```

### Building
```bash
./packages/opencode/script/build.ts --single  # Build standalone executable
```

### Pre-push Hook
The pre-push hook validates the Bun version matches `package.json` and runs `bun typecheck`.

## Architecture

**Monorepo** using Bun workspaces + Turborepo. Key packages:

- **`packages/opencode`** — Core business logic, CLI, server, and TUI
  - `src/agent/` — Agent definitions (build, plan, general subagent)
  - `src/session/` — Session management, LLM interaction, message processing, compaction
  - `src/tool/` — Tool implementations (bash, edit, glob, grep, read, write, webfetch, etc.)
  - `src/provider/` — LLM provider integrations (uses Vercel AI SDK)
  - `src/server/` — Hono-based HTTP API server with routes
  - `src/cli/cmd/tui/` — Terminal UI built with SolidJS + [opentui](https://github.com/sst/opentui)
  - `src/mcp/` — MCP (Model Context Protocol) client
  - `src/lsp/` — LSP integration
  - `src/config/` — Configuration management
  - `src/permission/` — Permission system for tool access
- **`packages/app`** — Shared web UI components (SolidJS + TailwindCSS v4 + Kobalte)
- **`packages/desktop`** — Native desktop app (Tauri, wraps `packages/app`)
- **`packages/sdk/js`** — Generated TypeScript SDK for the API
- **`packages/plugin`** — `@opencode-ai/plugin` package
- **`packages/ui`** — Shared UI primitives
- **`packages/util`** — Shared utilities
- **`sdks/vscode`** — VS Code extension
- **`packages/console`** — Console/web landing page
- **`infra/`** — Infrastructure (SST-based deployment)

## Style Guide

- Avoid `let`; use `const` with ternaries or early returns
- Avoid `else` statements; prefer early returns
- Avoid unnecessary destructuring — use `obj.a` instead of `const { a } = obj`
- Avoid `try`/`catch` — prefer `.catch(...)`
- Avoid `any` type; rely on type inference where possible
- Prefer single-word variable names when descriptive enough
- Use Bun APIs (e.g., `Bun.file()`) when applicable
- Keep logic in one function unless it's reusable/composable

## Testing

- Run tests with `bun test` from `packages/opencode`
- Avoid mocks; test actual implementations
- Do not duplicate logic into tests

## Formatting

Prettier config: no semicolons, 120 char print width. Configured in root `package.json`.

## PR Conventions

Titles follow conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:` — optionally scoped like `feat(app):` or `fix(desktop):`.
