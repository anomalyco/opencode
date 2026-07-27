# OpenCode Development Guide

## Quick Start
- Run OpenCode in dev mode: `bun dev` (from repo root, targets `packages/opencode` by default)
- Run against a different directory: `bun dev <directory>`
- Run OpenCode TUI against this repo itself: `bun dev .`

## Build & Type Check
- Type-check all packages: `bun turbo typecheck` or `bun run typecheck`
- Regenerate JavaScript SDK (after API changes): `./packages/sdk/js/script/build.ts`
- Build standalone binary: `./packages/opencode/script/build.ts --single`
- Do NOT run tests from repo root (`bun test` at root is a no-op); run tests within individual packages

## Architecture
- `packages/opencode`: Core business logic & server
- `packages/opencode/src/cli/cmd/tui/`: TUI code (SolidJS + opentui)
- `packages/plugin`: `@opencode-ai/plugin` source
- `packages/sdk/js`: JavaScript SDK for OpenCode API

## Important Conventions
- **ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE** — batch independent operations
- Default branch is `dev` — target all PRs to `dev`, not `master`
- After modifying API routes (in `packages/opencode/src/server/server.ts`), run `./script/generate.ts` to regenerate SDK
- Follow the [style guide](./STYLE_GUIDE.md)
- Use `bun` as package manager (bun@1.3.5)
- Prettier config: no semicolons, 120 char print width

## Debugging
- Debug server: `bun run --inspect=ws://localhost:6499/ ./src/index.ts serve --port 4096`
- Attach TUI: `opencode attach http://localhost:4096`
- For TUI + server breakpoints, use `bun dev spawn` instead of `bun dev`
