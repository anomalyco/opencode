# Agent principles (KanCode)

Repo-wide principles only. Package-level `AGENTS.md` owns package detail; `openspec/` owns planning workflow.

## Product

- Display name **KanCode** (`kancode`). Packages `@kancode/*`; app `@kancode/cli` in `packages/kancode`. Effect IDs `@kancode/...`.
- Keep provider catalog/wire id `"opencode"` (OpenCode Zen) — do not rename it.
- TUI/CLI product. Do not assume `packages/app|desktop|web|console` exist.
- Default branch: `main`.

## Config

- Load `kancode.json(c)` only — never `opencode.json(c)`.
- Project dir: `.kancode/` only — no project `.opencode/` discovery. Migrate legacy via built-in `import-opencode` skill. Exception: KanCode discovers skills from `.opencode/skill(s)/` (legacy layout) the same way it does from `.claude/`, `.agents/`, `.cursor/`, `.codex/`, `.kilo/` — config and other resources stay KanCode-only.
- User scope: `~/.kancode` (and XDG paths) — no `~/.opencode` fallback.
- Honor `OPENCODE_*` and `KANCODE_*`; `KANCODE_*` wins.

## Boundaries

- Runtime: Schema → Core; Protocol → Server. Client may use Schema/Protocol, never Core/Server. `sdk-next` composes Client + Core + Server.
- After public Protocol or Server `HttpApi` changes: regenerate from `packages/client` (`bun run generate`). Do not hand-edit `src/generated*`.
- Legacy JS SDK build: `packages/sdk/js/script/build.ts`.

## Git

- Branches: ≤3 hyphenated words, no slashes or type prefixes (`session-recovery`, not `feat/foo`).
- Commits / PR titles: `type(scope): summary` — `feat|fix|docs|chore|refactor|test`; scopes like `core`, `kancode`, `tui`, `sdk`, `plugin`, `server`, `cli`.

## Code

- Early returns; avoid `else` and `let` reassignment.
- No `any`; prefer inference. Prefer Bun APIs; avoid `try`/`catch` when possible.
- No aliased or star imports; import named exports.
- Prefer functional arrays; don’t extract single-use helpers. Inline single-use values.
- Effect: bind services before calling (no nested `yield* (yield* …)`).
- Drizzle fields: snake_case. Comments only for non-obvious constraints.

## Verify

- Tests and `bun typecheck` run from the **package directory**, never repo root.
- Prefer real implementation over mocks; avoid `globalThis` unless necessary. Never run `tsc` directly.
