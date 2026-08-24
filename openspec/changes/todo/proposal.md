# Todo — Error typing, Flag removal, and path resolution refactors

## Source

Absorbed from `packages/opencode/specs/effect/todo.md` on 2026-06-01 via `skein absorb`.

## Why

The codebase has several areas that need tightening:
- NamedError.create calls scattered across multiple packages are not properly typed through Effect's Schema system.
- The `Flag` module (20+ files importing it) is a legacy config abstraction that should be replaced with typed `Config` services.
- `global.ts` uses `Flag.OPENCODE_CONFIG_DIR` for path resolution, creating an unnecessary coupling.
- CLI/TUI error rendering surfaces show opaque `Error: Name` instead of structured typed error fields.

## What

Five concrete tasks were implemented:

1. **HTTP-2**: Audited the `session` route group for explicit error contracts. Decided per-call whether to inline mapping or use shared helpers. Decision log written at top of audit file.
2. **ERR-4**: Swept remaining `NamedError.create(...)` and `Effect.die(...)` callsites. Migrated expected failures to `Schema.TaggedErrorClass`; kept defect cases as `Effect.die`.
3. **RENDER-2**: Audited CLI and TUI surfaces for opaque `Error: Name` rendering. Wired `cliErrorMessage` helper to ensure structured fields (`reason`, `ref`) are rendered instead of raw error strings.
4. **RF-5**: Swept all `Flag.*` reads in CLI/TUI/config/observability (20+ files). Routed through `RuntimeFlags`, accepted as env/config boundary, or migrated to typed `Config`.
5. **GLOBAL-1**: Removed `Flag` dependency from `global.ts` path resolution. Replaced `Flag.OPENCODE_CONFIG_DIR ?? Path.config` with explicit `Config` service read. Added lazy init boundary.

## Scope

- `packages/core/src/global.ts` — Remove Flag import, add lazy init boundary
- `packages/core/src/util/error.ts` — Migrate NamedError.create calls
- `packages/core/src/v1/config/error.ts` — Migrate NamedError.create calls
- `packages/core/src/v1/session.ts` — Migrate NamedError.create calls
- `packages/opencode/src/ide/index.ts` — Migrate NamedError.create calls
- `packages/opencode/src/mcp/index.ts` — Migrate NamedError.create calls
- `packages/opencode/src/session/message-error.ts` — Migrate NamedError.create calls
- `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` — Error contract audit
- `packages/opencode/src/cli/cmd/run/runtime.ts` — Flag → RuntimeFlags
- `packages/opencode/src/cli/cmd/run/session-data.ts` — Flag → RuntimeFlags
- `packages/opencode/src/cli/cmd/run/stream.transport.ts` — Flag → RuntimeFlags
- `packages/opencode/src/config/config.ts` — Flag removal
- `packages/opencode/src/config/paths.ts` — Flag removal
- `packages/opencode/src/config/tui-migrate.ts` — Flag removal
- `packages/opencode/src/config/tui.ts` — Flag removal
- `packages/opencode/src/effect/runtime-flags.ts` — RuntimeFlags module
- `packages/opencode/src/loop/loop.ts` — Flag removal
- `packages/opencode/src/plugin/meta.ts` — Flag removal
- `packages/opencode/src/server/auth.ts` — Flag removal
- `packages/opencode/src/session/event-error.ts` — Cleanup
- `packages/tui/src/util/error.ts` — Structured error rendering
- `packages/sdk/js/src/v2/loop-args.ts` — Flag removal

- Build: `npm run build` (TypeScript/Effect project)
