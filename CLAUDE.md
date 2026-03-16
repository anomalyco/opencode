# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenCode is an open-source, provider-agnostic AI coding agent. It ships as a CLI (TUI), web app, and desktop app. The default branch is `dev` (not `main`).

## Common Commands

```bash
# Install dependencies
bun install

# Run CLI in dev mode (from repo root)
bun dev                    # starts TUI in packages/opencode dir
bun dev <directory>        # starts TUI in a specific directory
bun dev .                  # starts TUI in repo root
bun dev serve              # headless API server on port 4096
bun dev serve --port 8080  # custom port

# Type checking
bun turbo typecheck                          # entire monorepo
bun run --cwd packages/opencode typecheck    # single package (uses tsgo)
# NEVER run tsc directly — always use `bun typecheck` from package dirs

# Tests (NEVER run from repo root — it will fail)
cd packages/opencode && bun test             # all tests (30s timeout)
cd packages/opencode && bun test src/path/to/file.test.ts  # single test

# App unit tests
cd packages/app && bun test:unit
cd packages/app && bun test:unit:watch

# E2E tests (from packages/app)
cd packages/app && bun test:e2e              # all e2e
cd packages/app && bun test:e2e -- app/home.spec.ts        # single file
cd packages/app && bun test:e2e -- -g "test title"         # by name
cd packages/app && bun test:e2e:ui           # interactive Playwright UI

# Database migrations
cd packages/opencode && bun run db generate --name <slug>

# Regenerate JS SDK (after API/server changes)
./packages/sdk/js/script/build.ts

# Regenerate SDK and related files
./script/generate.ts

# Build standalone executable
./packages/opencode/script/build.ts --single
```

## Architecture

**Monorepo** (Bun workspaces + Turbo):

- `packages/opencode` — Core CLI, server, business logic, TUI (Solid.js + [opentui](https://github.com/sst/opentui)). This is the heart of the project.
- `packages/app` — Web UI (Solid.js + Vite + TailwindCSS). Shared between web and desktop.
- `packages/desktop` — Native desktop app (Tauri, wraps `packages/app`)
- `packages/desktop-electron` — Electron desktop app (alternative)
- `packages/console/*` — Admin console (SolidStart), includes billing (Stripe), auth, mail
- `packages/ui` — Shared component library (Solid.js)
- `packages/sdk/js` — Auto-generated TypeScript SDK from OpenAPI spec
- `packages/plugin` — Plugin system (`@opencode-ai/plugin`)
- `packages/web` — Marketing/docs site (Astro)
- `infra/` — Infrastructure as code (SST, Cloudflare Workers + AWS)

**Key technology choices:**

- Runtime: Bun
- Backend: Hono (HTTP framework)
- Database: Drizzle ORM with SQLite (schema in `src/**/*.sql.ts`)
- Error handling / services: Effect library
- AI: Vercel AI SDK (v5) with 15+ provider adapters
- Frontend: Solid.js (not React)

## Web App Local Development

`opencode dev web` proxies `https://app.opencode.ai` — local UI changes won't appear there. For local UI development:

1. Backend: `cd packages/opencode && bun run --conditions=browser ./src/index.ts serve --port 4096`
2. App: `cd packages/app && bun dev -- --port 4444`
3. Open `http://localhost:4444`

## Style Guide

- **Naming:** Single-word variable/function names by default. Multi-word only when a single word would be ambiguous. Inline values used only once.
- **No destructuring:** Use `obj.a` dot notation, not `const { a } = obj`.
- **No `else`:** Use early returns.
- **No `try/catch`:** Avoid where possible.
- **No `any`:** Use precise types.
- **No `let`:** Prefer `const` with ternaries or early returns.
- **Type inference:** Rely on inference; avoid explicit annotations unless needed for exports.
- **Functional:** Prefer `flatMap`/`filter`/`map` over `for` loops; use type guards on `filter`.
- **Bun APIs:** Prefer `Bun.file()` etc. when available.
- **Prettier:** `semi: false`, `printWidth: 120`.

## Database Conventions (Drizzle)

- Schema files: `src/**/*.sql.ts`
- Tables and columns: `snake_case`
- Join columns: `<entity>_id`
- Index names: `<table>_<column>_idx`
- Migrations output to `packages/opencode/migration/`

## Effect Patterns

- Services: `ServiceMap.Service<Name, Name.Service>()("@console/<Name>")` — always return `Name.of({...})` in `Layer.effect`
- Errors: `Schema.TaggedErrorClass`, use `Schema.Defect` for defect causes
- Composition: `Effect.gen(function* () {...})`, named effects with `Effect.fn("Name.method")`
- Time: prefer `DateTime.nowAsDate` over manual Date construction

## PR Conventions

Titles follow conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:` — optionally scoped like `feat(app):`, `fix(desktop):`.
