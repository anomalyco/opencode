# Execution UI spec coverage report

Task: T20 (final coverage report for the branch).
Branch: `execution-ui`, base `v2` @ `c555559ac1`, base of this task `6a19173992`.
Authority: `docs/superpowers/specs/2026-09-20-superpowers-execution-ui-design.md` §14, §16; plan
coverage table `docs/superpowers/plans/2026-09-20-superpowers-execution-ui.md` §D.

This report aggregates each acceptance criterion's owning tasks and recorded evidence. It is a
coverage index, not a substitute for the individual verification records. "UNRUN" and "FAILED" are
recorded exactly; no unavailable gate is labelled a pass (§16).

## Acceptance criteria

| ID | Owning tasks | Evidence | Status |
|---|---|---|---|
| AC01 | T01, T06, T20 | `baseline.md` (pinned contracts, no V1 SDK/todo), `integration.md`, this task's staged package build + browser contract import (`release-checklist.md` §3). No Core/Protocol/Server/Schema/generated-client change on the branch. | PASS |
| AC02 | T03, T17 | `task-5.md`, component suite tab classification/open/close/persist cases. | PASS |
| AC03 | T02, T04 | `task-2.md`, `task-4.md` recursive hydration and idle/foreground/missing-child cases. | PASS |
| AC04 | T02, T04, T18 | `task-4.md`, `integration.md` same-server child navigation and root retention. | PASS |
| AC05 | T05, T15, T17 | `task-5.md`, accessibility record; permission/question controls remain reachable and unmodified. | PASS |
| AC06 | T03, T09, T11, T18 | `task-6.md`, `integration.md` missing-plugin vs auth/offline/schema states. | PASS |
| AC07 | T06, T09, T10, T18 | `task-6.md`, plugin tests strict input and trusted root/ancestry. | PASS |
| AC08 | T08, T09, T18 | repository/plugin tests idempotency, serialized writes, restart, write failure. | PASS |
| AC09 | T06, T07, T10, T12 | reducer tests full transitions/attempts/scope/cancellation/final review. | PASS |
| AC10 | T07, T12 | progress tests: count fraction, provenance, absent denominator, review gates. | PASS |
| AC11 | T11, T18 | bridge/`integration.md` out-of-order replies, live-only events, reconnection, worktree scope. | PASS |
| AC12 | T12, T13 | `task-13.md` task/evidence UI, deterministic DAG, accessible list. | PASS |
| AC13 | T08, T14 | activity retention bounds and explicit truncation. | PASS |
| AC14 | T15, T17 | expanded/mobile state, focus restoration, pending-input access. | PASS |
| AC15 | T16, T18 | `task-13.md`/Home tests: bounded batches, ordinary rows unchanged. | PASS |
| AC16 | T02, T04, T12, T14 | telemetry partial/unknown handling, no double counting. | PASS |
| AC17 | T17 | `accessibility.md`: English keys, keyboard, RTL, motion, zoom. | PASS |
| AC18 | T01, T13, T19 | `task-13.md`, `performance.md`, `artifacts/t19-execution-benchmark.jsonl`. Paired T01 latency, status-render, and lifecycle gates pass; the causal unopened-dashboard long-task sub-gate is UNRUN because it needs a feature-absent counterfactual build. | UNRUN (causal long-task sub-gate) |
| AC19 | T09, T10, T18, T20 | This task: staged standalone package outside the monorepo with exact-version runtime dependencies installed into the staging tree (no repository symlinks), browser-safe contract import, built-plugin install/report/getRun/unload/reload/stored-state recovery, real disposable 2.0.11 host load and isolated restart (`release-checklist.md` §2–§5). | PASS |
| AC20 | T01, T20 | This task: web e2e against an explicitly selected disposable target (`release-checklist.md` §6); Windows Desktop smoke UNRUN, no Windows host (`release-checklist.md` §7). | Web PASS; Windows Desktop UNRUN |

## T20-owned criteria detail

### AC01 — builds against pinned V2 without V1 SDK/todo or Core/generated changes

- The companion builds to node ESM entrypoints (`dist/plugin.js`, `dist/contract.js`) plus
  declarations; `index.js` re-exports the built plugin.
- The staged contract imports in a real browser with no server modules and no node builtins.
- Branch diff vs `v2` touches no `packages/core`, `packages/protocol`, `packages/server`,
  `packages/schema`, or generated client files.

### AC19 — built package loads outside the monorepo and survives an isolated restart

- Staged outside the monorepo at `/tmp/opencode/superpowers-execution-package`; manifest dependencies
  resolved to `@opencode/plugin` 2.0.11, `@opencode/schema` 2.0.11, `zod` 4.1.8 (no `workspace:` /
  `catalog:` ranges) and installed as real copies into the staging tree, with each dependency's real
  path asserted outside the repository and inside the staging directory.
- `bun run package:smoke`: 4 pass / 1 skip / 0 fail.
- `bun run package:host-smoke`: 5 pass / 0 fail; the real disposable 2.0.11 server loads the staged
  directory entry (`entrypoint=file:///tmp/opencode/superpowers-execution-package/index.js`) and
  serves `capabilities` → `pluginVersion: "0.1.0"` before and after an isolated restart.

### AC20 — web and Windows Desktop smoke use an explicitly selected test server

- Web: `EXECUTION_E2E_TARGET` disposable target; 20 passed; credential artifact scan clean.
- Windows Desktop: **UNRUN** with the exact reason and manual steps in `release-checklist.md` §7.
  Real Windows smoke evidence must be obtained before the project is called done.

## Branch-level open items

| Item | Record | Status |
|---|---|---|
| Windows Desktop smoke (AC20) | `release-checklist.md` §7 | UNRUN — no Windows host |
| Unopened-dashboard causal long-task attribution (AC18) | `performance.md` (T19) | UNRUN — needs a feature-absent build |
| `packages/app` component suite `production session owner loads native telemetry for agents` | `release-checklist.md` §8.1 | FAILED — T19 visibility gating vs. non-representative fixture; open blocker |
| Desktop `browser-native` / `browser-idle` Electron tests | `release-checklist.md` §7 | FAILED — Electron refuses to run as root without `--no-sandbox` |
| Root `bun run check` | `release-checklist.md` §8.2 | FAILED — pre-existing `@opencode/posts#typecheck` (`@tsconfig/bun` not found) |
| `packages/app typecheck:e2e` | `release-checklist.md` §8.2 | 3 pre-existing unrelated errors |

## Definition of done (§16)

All acceptance criteria have corresponding tests or explicitly recorded manual checks. The root
full check, affected package tests, production app build, UI/component tests, regression
benchmarks, local-package smoke, and Windows Desktop smoke have real outcomes recorded above.
Failing or unavailable checks are recorded with their evidence and are never called passing. The
Windows Desktop smoke and the `packages/app` component regression remain open at the time of this
record; the project must not be called fully done until they are resolved or the user explicitly
revises the target.
