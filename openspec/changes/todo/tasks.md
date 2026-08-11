# Tasks — Todo

<!-- absorbed from: packages/opencode/specs/effect/todo.md -->
<!-- Fixed: absorb truncated task descriptions; rebuilt from source -->

- [x] `HTTP-2` Audit **one** route group (e.g. `session` at `src/server/routes/instance/httpapi/public.ts`) for explicit error contracts.
  - Enumerate every `Error`-returning service call in that group's handlers.
  - Decide per-call: inline map (1→1 error→HTTP) or extract shared helper.
  - Write a short decision log at the top of the audit file explaining each choice.
  - Validation: `cd packages/opencode && npm run build` — compiles without error; grep the chosen route group for `NamedError.Unknown` and verify no unhandled `Cause.DieReason` reaches the HTTP layer.

- [x] `ERR-4` Sweep remaining `NamedError.create(...)` and `Effect.die(...)` callsites.
  - `git grep -n 'NamedError\.create' -- '*.ts'` — current inventory: 5 files, ~21 callsites (core/error.ts, v1/config/error.ts, v1/session.ts, ide/index.ts, mcp/index.ts, session/message-error.ts).
  - For each callsite: classify as (a) expected failure → migrate to `Schema.TaggedErrorClass`, (b) defect → keep `Effect.die`, or (c) already-migrated false positive.
  - Migrate all (a) cases; update callers to handle the new error union type.
  - Validation: `cd packages/opencode && npm run build` — compiles; `git grep -c 'NamedError\.create' -- '*.ts'` returns 0 in packages/opencode.

- [x] `RENDER-2` Audit CLI and TUI surfaces for opaque `Error: Name` rendering of typed errors.
  - Search CLI handler output paths (src/cli/commands/*.ts, src/cli/cmd/run/*.surface.ts) and TUI error surfaces for patterns like `String(error)` or `error.toString()` on Effect-failures.
  - For each occurrence: ensure the error's schema fields (e.g. `reason`, `ref`) are rendered, or route through a typed error renderer.
  - Validation: `cd packages/opencode && npm run build` — compiles; run the CLI with a known typed failure and verify structured fields appear (not `Error: Name`).
- [x] `RF-5` Sweep `Flag.*` reads in CLI/TUI/config/observability (20+ files still import flag.ts).
  - `git grep -l 'Flag\.' -- '*.ts'` to get current inventory (~20 files).
  - Per callsite: route through `RuntimeFlags`, accept as env/config boundary, or migrate to typed `Config`. No Flag imports left in opencode package code (test fixtures and core-only env reads OK).
  - Validation: `cd packages/opencode && npm run build` — compiles; `git grep 'from.*flag/flag' -- 'packages/opencode/**/*.ts'` returns 0.

- [x] `GLOBAL-1` Remove `Flag` dependency from `global.ts` path resolution.
  - `global.ts:64` currently does `Flag.OPENCODE_CONFIG_DIR ?? Path.config` — replace with an explicit `Config` service read.
  - Move directory creation and `Flock` setup behind an explicit init boundary (lazy init or explicit `init()` call).
  - Validation: `cd packages/opencode && npm run build` — compiles; `git grep 'import.*Flag' -- 'packages/core/src/global.ts'` returns 0.
