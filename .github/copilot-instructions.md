# Copilot instructions — OpenCode monorepo

Purpose: concise, repo-specific guidance for Copilot/automation sessions.

---

## Quick setup & prerequisites

- Requires Bun 1.3+ (repo packageManager: `bun@...`).
- From repo root:
  - `bun install` — install workspace deps
  - `bun dev` — start default dev server (runs `packages/opencode` by default)
  - `bun run typecheck` — turbo typecheck across workspace
- Note: tests are intentionally guarded at repo root (root `test` prints an error). Run tests from the package that owns them (see examples below).

## Build / test / lint (examples)

- General
  - Build a standalone OpenCode binary: `./packages/opencode/script/build.ts --single`
  - Run a package script from repo root: `bun run --cwd packages/<pkg> <script>`

- packages/app (web)
  - `bun run --cwd packages/app dev` — start web dev server
  - `bun run --cwd packages/app test:e2e` — run Playwright E2E
  - Run a single E2E spec: `bun run --cwd packages/app test:e2e -- path/to/feature-name.spec.ts`
  - Run a single test by title: `bun run --cwd packages/app test:e2e -- -g "test title"`
  - Unit tests: `bun run --cwd packages/app test:unit` (bun test supports path/filters)

- sdks/vscode (VS Code extension)
  - `cd sdks/vscode`
  - `bun install`
  - `bun run lint` — runs `eslint src`
  - `bun run compile-tests` — `tsc -p tsconfig.test.json`
  - `bun run test` — runs `vscode-test run --config .vscode-test.mjs`
  - To run a single test: compile tests and run the compiled file or use the underlying test runner's filters (e.g. compile then run the compiled test at `out/.../testfile.js`, or pass filters to the runner).
  - Debug the extension with VS Code Insiders and `--enable-proposed-api sst-dev.opencode`.

- packages/desktop (Tauri)
  - `bun run --cwd packages/desktop tauri dev`

- General lint
  - Run a package lint script or: `bun run --cwd packages/<pkg> lint` (where defined)

## How to run a single test (summary)

- Playwright E2E (packages/app/e2e): `bun run --cwd packages/app test:e2e -- path/to/spec.ts` or `-- -g "title"` to filter by name.
- bun-based unit tests: `bun test <path>` or the package's `test` script with a path/filter.
- For VS Code extension tests (vscode-test), compile (`compile-tests`) then run the specific compiled test artifact or use runner filtering where supported.

## High-level architecture (big picture)

- Monorepo (Bun + Turbo). Default branch: `dev`.
- Key packages:
  - `packages/opencode` — core server, CLI, and TUI (server & business logic)
  - `packages/app` — web UI (SolidJS + Vite)
  - `packages/desktop` — Tauri wrapper for native app
  - `packages/sdk/js` — JavaScript SDK build
  - `sdks/vscode` — VS Code extension (requires proposed APIs; use VS Code Insiders)
  - Several other packages (`plugin`, `console`, `ui`, `storyboard`, etc.) compose features and integrations.
- Tests & CI
  - E2E: Playwright under `packages/app/e2e` (fixtures, helpers, and selectors live there).
  - Unit tests: per-package `bun test` or package test scripts. **Do not run tests from repo root.**

## Key repository conventions (what Copilot should follow)

- Tooling & branches
  - Use Bun for package tasks where possible; many scripts assume `bun`.
  - Default branch for diffs and PRs: `dev` (local `main` may not exist).
  - Regenerate the JS SDK with: `./packages/sdk/js/script/build.ts`.

- Coding style (see `AGENTS.md` / `CONTRIBUTING.md` for full details)
  - Prefer single-word variable names when they remain descriptive.
  - Favor `const` over `let` and avoid unnecessary destructuring.
  - Avoid `try`/`catch` where possible; prefer `.catch(...)` for promises.
  - Prefer Bun APIs (e.g., `Bun.file()`) and use type inference; avoid `any`.
  - Drizzle schema fields: use `snake_case` column names.
  - Keep logic in one function unless composition or reuse justifies breaking out.

- Testing & PR workflow
  - Tests should avoid mocks where possible — prefer testing real implementations.
  - Tests cannot run from repo root (guard `do-not-run-tests-from-root`); execute tests from the package directory.
  - PRs must reference an existing issue (Issue-first policy). Use `Fixes #NN` in the PR body.
  - PR titles should follow conventional commits (e.g., `feat(app): ...`, `fix: ...`).
  - Do not submit long AI-generated PR descriptions (keep PR bodies focused and human-written).
  - There is a vouch system at `.github/VOUCHED.td` for trusted contributors.

- Automation/Copilot-specific rules
  - ALWAYS use parallel tool calls when independent operations can be parallelized.
  - Prefer package-level operations (use `--cwd` or `cd` into the package) rather than performing heavy work at repo root.
  - Respect repo guards (do not run root test scripts, follow PR/issue policy).

## Files to consult (shortlist)
- `CONTRIBUTING.md` — setup, `bun dev`, debugging and build commands
- `AGENTS.md` — style guide, testing guardrails, and the parallel-tools note
- `packages/app/e2e/AGENTS.md` — Playwright patterns and single-test examples
- `sdks/vscode/README.md` & `sdks/vscode/package.json` — extension-specific scripts and dev notes

---

If you want, I can also add suggested MCP server configs (for example Playwright e2e runners) into the repo’s CI/workflows — would you like me to add MCP server configuration for Playwright or other services?