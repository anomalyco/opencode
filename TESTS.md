# TESTS

This repo has a wide test surface. To keep current work unblocked, use this staged plan and run heavier suites later when budget/time is better.

## Stage 1 (Run Now / Cheapest)

Use this as the day-to-day gate:

```bash
bun run release:gate
```

What it covers:
- Workspace typecheck
- App production build (embedded via `packages/opencode/script/build.ts`)
- Native single-target smoke build (`--single --skip-install`)

Feature-targeted fast checks (multi-account/session selection):

```bash
bun --cwd packages/app test src/components/prompt-input/submit.test.ts src/pages/session/session-model-helpers.test.ts
```

## Stage 2 (Deferred Unit Suites)

Run these when we are ready to spend more runtime:

```bash
bun --cwd packages/app test:unit
bun --cwd packages/opencode test
```

## Stage 3 (Deferred CI-Heavy Suites)

Run these when we want near-CI parity:

```bash
bun turbo test:ci
bun --cwd packages/app test:e2e:local
```

## Suggested Order

1. Stage 1 for every PR.
2. Stage 2 before release candidate cut.
3. Stage 3 before final ship or when touching risky cross-platform paths.

## Notes

- Do not use root `bun test` (it intentionally fails by design).
- If Stage 1 passes but Stage 2/3 fails, treat those as release blockers and fix before ship.

## Manual Testing Steps (Multi-Account)

1. Connect two accounts for the same provider (for example `work` and `personal`).
2. Pick a model under account A, send a prompt, and confirm it succeeds.
3. Switch to account B for the same provider, pick the same model, and send a prompt.
4. Run session compact and verify it succeeds under the selected account.
5. Reload app/session and confirm selected provider/model/account remains valid.
