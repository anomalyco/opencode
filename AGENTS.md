# Agent rules (KanCode)

Daily rules for agents. Package-level `AGENTS.md` files add package-specific detail.

## Product / fork

- Display name: **KanCode** (`kancode`). Keep `@opencode-ai/*` package names, `packages/opencode`, Effect service IDs, and provider id `"opencode"` (OpenCode Zen) unless an explicit rename is requested.
- TUI/CLI-focused. Do not assume web/desktop/console packages (`packages/app`, `packages/desktop`, `packages/web`, `packages/console`) still exist.
- Default branch: `main` (diff against `main` / `origin/main`).
- Config: project/worktree **merge-includes** `opencode.json(c)` then `kancode.json(c)` (KanCode wins) and both `.opencode/` / `.kancode/` (`.kancode` wins). **User scope** (XDG/global, `~/.kancode`, data/cache/state/tmp/managed) is KanCode-only — no OpenCode user fallback. Honor `OPENCODE_*` and `KANCODE_*` (`KANCODE_*` wins).

## OpenSpec

Spec-driven planning lives under `openspec/`. Product scope for planning prompts: `openspec/config.yaml`.

Workflow: **propose → apply → archive** (plus explore / update / sync when needed).

- Slash commands: `.cursor/commands/` (`/opsx:*`)
- Skills: `.cursor/skills/openspec-*`

Keep day-to-day coding rules here; do not duplicate full OpenSpec docs.

## Dependencies / codegen

- Runtime direction: Schema → Core and Protocol → Server. Client may depend on Schema and Protocol but never Core or Server; `sdk-next` composes Client, Core, and Server.
- After public Protocol or Server `HttpApi` changes: `bun run generate` from `packages/client` (do not edit `src/generated` or `src/generated-effect`).
- Legacy JS SDK: `./packages/sdk/js/script/build.ts`.

## Branch / commits

- Branches: at most three hyphenated words, no slashes or type prefixes (`session-recovery`, not `feat/foo`).
- Commits and PR titles: `type(scope): summary` — types `feat`, `fix`, `docs`, `chore`, `refactor`, `test`; optional scopes such as `core`, `opencode`, `tui`, `sdk`, `plugin`, `server`, `cli`.

## Style (minimal)

- Prefer early returns; avoid `else` and `let` reassignment
- No `any`; prefer type inference over explicit annotations
- Avoid `try`/`catch` where possible; prefer Bun APIs (`Bun.file()`)
- No aliased or star imports; import namespace exports by name when needed
- Prefer functional array methods; do not extract single-use helpers preemptively
- Inline single-use values; avoid unnecessary destructuring
- Effect: bind services to named variables before calling (no nested `yield* (yield* …)`)
- Drizzle schema fields: snake_case
- Comments only for non-obvious constraints

## Tests / typecheck

- Run tests from package directories (not repo root; guard `do-not-run-tests-from-root`). Prefer real implementation over mocks; avoid `globalThis` unless necessary.
- Typecheck with `bun typecheck` from the package directory — never `tsc` directly.
