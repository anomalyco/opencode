# OpenCode Monorepo Agent Guide

This file is for coding agents working in `/Users/ryanvogel/dev/opencode`.

## Scope And Precedence

- Start with this file for repo-wide defaults.
- Then check package-local `AGENTS.md` files for stricter rules.
- Existing local guides include `packages/opencode/AGENTS.md` and `packages/app/AGENTS.md`.
- Package-specific guides override this file when they conflict.

## Repo Facts

- Package manager: `bun` (`bun@1.3.11`).
- Monorepo tool: `turbo`.
- Default branch: `dev`.
- Root test script intentionally fails; do not run tests from root.

## Cursor / Copilot Rules

- No `.cursor/rules/` directory found.
- No `.cursorrules` file found.
- No `.github/copilot-instructions.md` file found.
- If these files are added later, treat them as mandatory project policy.

## High-Value Commands

Run commands from the correct package directory unless noted.

### Root

- Install deps: `bun install`
- Run all typechecks via turbo: `bun run typecheck`
- OpenCode dev CLI entry: `bun run dev`
- OpenCode serve (common): `bun run dev serve --hostname 0.0.0.0 --port 4096`

### `packages/opencode`

- Dev CLI: `bun run dev`
- Typecheck: `bun run typecheck`
- Tests (all): `bun test --timeout 30000`
- Tests (single file): `bun test test/path/to/file.test.ts --timeout 30000`
- Tests (single test name): `bun test test/path/to/file.test.ts -t "name fragment" --timeout 30000`
- Build: `bun run build`
- Drizzle helper: `bun run db`

### `packages/app`

- Dev server: `bun dev`
- Build: `bun run build`
- Typecheck: `bun run typecheck`
- Unit tests (all): `bun run test:unit`
- Unit tests (single file): `bun test --preload ./happydom.ts ./src/path/to/file.test.ts`
- Unit tests (single test name): `bun test --preload ./happydom.ts ./src/path/to/file.test.ts -t "name fragment"`
- E2E tests: `bun run test:e2e`

### `packages/mobile-voice`

- Start Expo: `bun run start`
- Start Expo dev client: `bunx expo start --dev-client --clear --host lan`
- iOS native run: `bun run ios`
- Android native run: `bun run android`
- Lint: `bun run lint`
- Expo doctor: `bunx expo-doctor`
- Dependency compatibility check: `bunx expo install --check`

### `packages/apn-relay`

- Start relay: `bun run dev`
- Typecheck: `bun run typecheck`
- DB connectivity check: `bun run db:check`

## Build / Lint / Test Expectations

- Always run the narrowest checks that prove your change.
- For backend changes: run package typecheck + relevant tests.
- For mobile changes: run `expo lint` and at least one `expo` compile-style command if possible.
- Never claim tests passed unless you ran them in this workspace.

## Single-Test Guidance

- Prefer running one file first, then broaden scope.
- For Bun tests, pass the file path directly.
- For name filtering, use `-t "..."`.
- Keep original timeouts when scripts define them.

## Code Style Guidelines

These conventions are already used heavily in this repo and should be preserved.

### Formatting

- Use Prettier defaults configured in root: `semi: false`, `printWidth: 120`.
- Keep imports grouped and stable; avoid noisy reorder-only edits.
- Avoid unrelated formatting churn in touched files.

### Imports

- Prefer explicit imports over dynamic imports unless runtime gating is required.
- Prefer existing alias patterns (for example `@/...`) where already configured.
- Do not introduce new dependency layers when a local util already exists.

### Types

- Avoid `any`.
- Prefer inference for local variables.
- Add explicit annotations for exported APIs and complex boundaries.
- Prefer `zod` schemas for request/response validation and parsing.

### Naming

- Follow existing repo preference for short, clear names.
- Use single-word names when readable; use multi-word only for clarity.
- Keep naming consistent with nearby code.

### Control Flow

- Prefer early returns over nested `else` blocks.
- Keep functions focused; split only when it improves reuse or readability.

### Error Handling

- Fail with actionable messages.
- Avoid swallowing errors silently.
- Log enough context to debug production issues (IDs, env, status), but never secrets.
- In UI code, degrade gracefully for missing capabilities.

### Data / DB

- For Drizzle schema, use snake_case fields and columns.
- Keep migration and schema changes minimal and explicit.
- Follow package-specific DB guidance in `packages/opencode/AGENTS.md`.

### Testing Philosophy

- Prefer testing real behavior over mocks.
- Add regression tests for bug fixes where practical.
- Keep fixtures small and focused.

## Agent Workflow Tips

- Read existing code paths before introducing new abstractions.
- Match local patterns first; do not impose a new style per file.
- If a package has its own `AGENTS.md`, review it before editing.
- For OpenCode Effect services, follow `packages/opencode/AGENTS.md` strictly.

## Known Operational Notes

- `packages/app/AGENTS.md` says: never restart app/server processes during that package's debugging workflow.
- `packages/app/AGENTS.md` also documents local backend+web split for UI work.
- `packages/opencode/AGENTS.md` contains mandatory Effect and database conventions.

## Regeneration / Special Scripts

- Regenerate JS SDK with: `./packages/sdk/js/script/build.ts`

## Quick Checklist Before Finishing

- Ran relevant package checks.
- Updated docs/config when behavior changed.
- Avoided committing unrelated files.
- Kept edits minimal and aligned with local conventions.
