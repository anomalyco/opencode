# OpenCode AGENTS.md

## Ground Rules

- Default branch is `dev`, not `main`.
- Package manager: Bun 1.3.13 (exact). Pre-push hook enforces version match.
- PRs require conventional commit titles (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`) + linked issue (`Fixes #N`). Docs/refactor/feat PRs skip the issue requirement.
- Use `--no-verify` only when CI codegen (`chore: generate`) or user explicitly requests it.
- Run `./script/generate.ts` after changing API routes or SDK surfaces; CI auto-generates on push to `dev`.

## Monorepo Map

```
packages/opencode     Core server, CLI, TUI (SolidJS + opentui)
packages/app          Web UI (SolidJS, Vite)
packages/desktop      Tauri desktop app (wraps packages/app)
packages/desktop-electron  Electron desktop app
packages/ui           Shared UI components
packages/plugin       @opencode-ai/plugin
packages/sdk          SDK (JS)
packages/console      Console app
packages/function     Backend functions
packages/identity     Auth/identity
packages/enterprise   Enterprise features
```

Dependencies: `@opencode-ai/sdk`, `@opencode-ai/ui`, `@opencode-ai/shared`, `@opencode-ai/plugin` are `workspace:*`.

## Dev Commands

```bash
bun install                   # Install deps (exact versions via bunfig.toml)
bun dev                       # Run TUI against packages/opencode dir
bun dev <directory>           # Run TUI against different dir
bun dev serve                 # Headless API server (port 4096)
bun dev web                   # Server + proxy web UI (hits production app.opencode.ai)
bun lint                      # oxlint (type-aware)
bun typecheck                 # turbo typecheck across all packages
```

For local UI dev, run server + app separately:
```bash
# Server (from root or packages/opencode)
bun dev serve
# App (from packages/app)
bun dev -- --port 4444
# Open http://localhost:4444
```

## Testing

**NEVER run tests from repo root.** Guard exists in `bunfig.toml` and `package.json`.

```bash
# Unit tests
bun test                        # packages/opencode: bun test --timeout 30000
bun test:unit                   # packages/app: bun test --preload ./happydom.ts ./src
bun test:unit:watch             # packages/app: watch mode

# E2E (packages/app, uses Playwright chromium)
bun test:e2e:local              # local e2e run

# CI
bun turbo test:ci               # runs all test:ci tasks
```

Test fixtures (`packages/opencode/test/fixture/fixture.ts`):
- `tmpdir({ git, config, init, dispose })` – creates temp dir, auto-cleans via `await using`
- `testEffect(layers)` – for Effect-based tests; use `it.live()` for real I/O, `it.effect()` for simulated clock
- `provideTmpdirInstance(cb)` – creates temp dir, binds as active Instance, runs Effect, cleans up

## Type Checking

```bash
bun typecheck                   # from root: turbo typecheck (all packages)
bun typecheck                   # from packages/opencode: tsgo --noEmit
bun typecheck                   # from packages/app: tsgo -b
```

Never use `tsc` directly. Each package uses `tsgo` (TypeScript native preview) or `--noEmit`.

## Style Guide

### General
- Keep logic in one function unless composable/reusable.
- Avoid `try`/`catch`; prefer `.catch(...)`.
- Avoid `any`; prefer precise types.
- Use Bun APIs when available (`Bun.file()`, `Bun.write()`, etc.).
- Prefer `const` over `let`; ternaries over reassignment; early returns over `else`.
- Avoid unnecessary destructuring — use dot notation to preserve context.
- Inline variables used only once.

### Effect Framework (packages/opencode)
- Use `Effect.gen(function* () { ... })` for composition.
- Use `Effect.fn("Domain.method")` for named/traced effects, `Effect.fnUntraced` for internal.
- No `export namespace Foo {}` — use flat top-level exports + `export * as Foo from "."` at bottom.
- Multi-sibling directories (e.g., `src/session/`, `src/config/`): no barrel `index.ts` — import specific files.
- Use `makeRuntime` for services, `InstanceState` (via `ScopedCache`) for per-directory state.
- `Effect.forkIn(scope)` not `Effect.fork`/`Effect.forkDaemon` (Effect v4 beta).
- Prefer Effect services (`FileSystem`, `HttpClient`, `ChildProcessSpawner`, `Path`, `Clock`) over raw platform APIs.

### Database
- Drizzle schema in `src/**/*.sql.ts`. Snake_case tables/columns.
- Migrations: `bun run db generate --name <slug>` (from `packages/opencode`).
- Output: `migration/<timestamp>_<slug>/migration.sql`.

### SolidJS (packages/app, packages/opencode TUI)
- Prefer `createStore` over multiple `createSignal` calls.

### Desktop Packages
- **Tauri** (`packages/desktop`): Never call `invoke` manually; use generated bindings from `src/bindings.ts`.
- **Electron** (`packages/desktop-electron`): Renderer calls `window.api` only; main process registers IPC in `src/main/ipc.ts`.

## Pre-push Hook

Runs `bun typecheck`. If it fails, push is rejected. Fix type errors locally before pushing.

Lint is NOT in the hook — run `bun lint` manually or let CI catch it.

## CI (GitHub Actions)

- **test**: Unit (linux + windows, `bun turbo test:ci`) + E2E (Playwright chromium in packages/app)
- **typecheck**: `bun typecheck`
- **generate**: Runs `./script/generate.ts` on push to dev, commits result
- **pr-standards**: Enforces conventional commit titles and linked issues for PRs
- **publish**: Full build pipeline (CLI + Tauri + Electron + npm + Docker)

## Code Generation

After changing API routes, server endpoints, or SDK types:
```bash
./script/generate.ts
```
This regenerates the JS SDK and related files. CI auto-runs this on push to dev.

## Debugging

```bash
bun dev spawn                  # Debug-friendly TUI (server in separate process)
bun run --inspect=ws://localhost:6499/ --cwd packages/opencode ./src/index.ts serve --port 4096
opencode attach http://localhost:4096   # Attach TUI to debugged server
```

For app debugging: NEVER restart the app or server process from within the debugging session.
