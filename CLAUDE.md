# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Core development
bun install                           # install dependencies
bun dev                               # run opencode TUI (in packages/opencode dir)
bun dev <directory>                   # run against specific directory
bun dev .                             # run in repo root

# Type checking
bun turbo typecheck                   # typecheck all packages

# Building
./packages/opencode/script/build.ts --single  # build standalone executable

# Web app (packages/app)
bun run --cwd packages/app dev        # dev server at localhost:5173

# Desktop app (packages/desktop) - requires Tauri/Rust
bun run --cwd packages/desktop tauri dev    # native app + dev server
bun run --cwd packages/desktop tauri build  # production build

# SDK regeneration (after API changes)
./packages/sdk/js/script/build.ts     # regenerate JS SDK
./script/generate.ts                  # regenerate SDK and related files
```

## Architecture

**Monorepo** using Bun workspaces with Turbo for task orchestration.

**Key packages:**
- `packages/opencode` - Core CLI, server, and TUI (main business logic)
- `packages/app` - Web UI components (SolidJS)
- `packages/desktop` - Native desktop app (Tauri v2 wrapping app)
- `packages/console` - Cloud SaaS (Cloudflare Workers, PlanetScale)
- `packages/sdk` - TypeScript SDK (@opencode-ai/sdk)
- `packages/plugin` - Plugin system (@opencode-ai/plugin)

**Client-Server model:**
- HTTP server (`packages/opencode/src/server/server.ts`) built on Hono
- TUI client (`packages/opencode/src/cli/cmd/tui/`) using SolidJS + OpenTUI
- Sessions, tools, and LLM requests flow through the server

**Agent system** (`packages/opencode/src/agent/`):
- `build` - default agent with full access
- `plan` - read-only for analysis/exploration
- `general` - subagent for complex searches (invoke with @general)

**Tool system** (`packages/opencode/src/tool/`): 40+ tools (bash, edit, read, grep, glob, write, lsp, etc.) with permission checks and plugin extensibility.

**Provider system** (`packages/opencode/src/provider/`): 20+ LLM providers via ai SDK (Claude, OpenAI, Google, Bedrock, etc.)

## Code Style

- Prefer `const` over `let`; use ternary or early returns to avoid mutation
- Avoid `else` statements; use early returns
- Avoid unnecessary destructuring; prefer `obj.a` over `const { a } = obj` for context
- Prefer `.catch()` over try/catch
- Single-word variable names when descriptive enough
- Use Bun APIs (e.g., `Bun.file()`) when available
- Avoid `any` type

## Git/PR Guidelines

- Default branch: `dev`
- All PRs must reference an existing issue (`Fixes #123` or `Closes #123`)
- Conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`
- Optional scope: `feat(app):`, `fix(desktop):`
- Keep PRs small and focused; no AI-generated walls of text
- UI changes need screenshots/videos

## Important Notes

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE
- After API/SDK changes in server.ts, run `./script/generate.ts`
- Tests run from individual packages, not root (`bun run test` from root will fail)
