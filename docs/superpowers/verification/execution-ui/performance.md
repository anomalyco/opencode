# Task 19 verification: performance budgets and lifecycle cleanup

Spec coverage: AC18. Authority: spec §13 and §6.3.

## Environment

| Item | Value |
|---|---|
| Branch | `execution-ui` |
| Base | `v2` at `c555559ac1b94910b769eebaa595b2b8822efa14` (OpenCode 2.0.11) |
| Measured working tree | T19 commit `perf(app): enforce execution rendering and lifecycle budgets` + `fix(app): address execution performance review findings` (base `fb485c3d5ec4b175d22f61fe4153592f0efd7a46`) |
| Bun | 1.4.2 |
| Node (Playwright driver) | v24.21.0 |
| Playwright / Chromium | 1.59.1 / chromium-1217 (`147.0.7727.15`) |
| Machine | WSL2, AMD Ryzen 5 2600 (6 cores / 12 threads), 7.7 GiB RAM, Linux 5.15 |
| App mode | production build (`bun run build` + `bun run serve`), served at `http://127.0.0.1:3000` |
| Disposable host | in-process `disposable-host.ts` stand-in at `http://127.0.0.1:4611` |

The disposable host is the T18 stand-in (plugin source over real HTTP RPC and file storage); it is not the
built companion package and is not AC19 evidence. No user service was contacted.

## Fixtures and methods

| Concern | Fixture | Size |
|---|---|---|
| Lifecycle harness runs | `src/superpowers/lifecycle.ts` synthetic run per root | 1 task, 0–50 descendants |
| Render/status budget tasks | `measureGraphBudgets()` DAG | 500 tasks / 480 edges; long-title variant |
| Retained events | `createExecutionModel` activity projection | 1,000 events, page size 100 |
| Closed-dashboard host tasks | disposable host `run.start` | 100 tasks (flat, status-transitionable) |
| Closed-dashboard host sessions | disposable host `sessions` control | root + 50 descendants + 1 plain session |
| T01 tab-switch gate | `session-tab-switch.fixture` + stress tabs | 2 sessions, 200 exchanges / 400 messages each |
| T01 Home-entry gate | `session-timeline-stress.fixture` | Home → cold session |

`lifecycleHarness` wires the **actual** feature instances — `createSessionExecution` (bridge + model) and
`createNativeExecutionOwner` / `createNativeExecutionAdapter` — through injected event, clock, request, and
native-boundary fakes. `cacheSize` is probed through the bridge's public `attach`/`getSnapshot` with the
connection disabled so no network fetch perturbs the cache.

## Unit lifecycle budgets

### Step 2 RED (before implementation)

```text
$ cd packages/app
$ bun test --conditions=solid --preload ./happydom.ts ./src/superpowers/lifecycle.test.ts
src/superpowers/lifecycle.test.ts:
# Unhandled error between tests
error: Cannot find module './lifecycle' from '.../lifecycle.test.ts'
 0 pass
 1 fail
 1 error
```

### Step 4 GREEN (after implementation; see `/tmp/opencode/t19-lifecycle-tests.log`)

```text
$ cd packages/app
$ bun test --conditions=solid --preload ./happydom.ts ./src/superpowers
[task-19-perf] rendering={"graphLayout500Ms":4.1859...,"graphLayout500P95Ms":4.1859...,"graphLayoutsForTokenOnlyUpdates":0,"graphLayoutsForLongTitles":0,"retainedNodes":500}
[task-19-lifecycle] rendering={"graphLayout500Ms":1.1365...,"graphLayout500P95Ms":1.1365...,"graphLayoutsForTokenOnlyUpdates":0,"graphLayoutsForLongTitles":0,"retainedNodes":500}
[task-19-lifecycle] baseline=0 listeners=0 intervals=0 cache=0 concurrent=1 closedPolls=0
 190 pass / 0 fail
```

| Target (§13) | Measured | Result |
|---|---|---|
| 500-task graph layout: every cold run ≤ 250 ms | max cold run 1.14–4.19 ms over 5 runs (p95 equals max for n=5) | PASS |
| No relayout for token/status-only updates | `graphLayoutsForTokenOnlyUpdates = 0`; retained nodes stayed 500 | PASS |
| No relayout for long titles | `graphLayoutsForLongTitles = 0` | PASS |
| 1,000 retained events stay bounded | activity page holds 100 of 1,000 with `hasMore` | PASS |
| Listeners return to baseline after 50 open/close and 50 root switches | 0 → 0 | PASS |
| Intervals return to baseline | 0 | PASS |
| Run cache ≤ 20 within one scope | 20 after 25 distinct runs (evicts oldest) | PASS |
| Detail fetches concurrent ≤ 4 (50 descendants) | 4 | PASS |
| Hidden dashboard makes no interval full-run poll | 0 over 10 intervals | PASS |
| Hiding the tab suspends and resuming restores the single safety interval | 1 → 0 → 1 | PASS |

The 500-task figure is a pure Bun-side layout (T13 method); the acceptance value is now the **maximum** cold
run, not the minimum. Status-update render latency and browser long tasks are measured in the real app below,
not by the unit harness.

## T01 session-switch gates (AC18 regression target)

The 10% gate is enforced on the recorded T01 scenarios with the T01 fixture, probe, and
first-correct/stable timeline milestones, comparing this machine's measured p95 against the recorded
pre-feature T01 p95 (`baseline.md`) × 1.10. 20 samples per scenario.

```text
$ cd packages/app
$ PLAYWRIGHT_BUILD=1 EXECUTION_E2E_TARGET='{"disposable":true,"directory":"/tmp/opencode/execution-perf","port":4611}' \
    bun run test:e2e --config e2e/performance/playwright.config.ts \
    superpowers/execution-benchmark.spec.ts --workers=1
 7 passed (2.1m)
```

Run exactly as listed in the brief (no `EXECUTION_E2E_TARGET`), the three T01 gates execute and the four
disposable-host gates are UNRUN:

```text
$ cd packages/app
$ bun run test:e2e --config e2e/performance/playwright.config.ts superpowers/execution-benchmark.spec.ts --workers=1
 3 passed
 4 skipped
```

| Scenario | T01 recorded p95 (firstCorrect / stable) | Measured p95 (firstCorrect / stable) | Budget (×1.10) | Result |
|---|---|---|---|---|
| tab switch: cold, review closed | 530.90 / 583.00 ms | 375.70 / 425.00 ms | 583.99 / 641.30 ms | PASS |
| tab switch: warm, review closed | 106.60 / 305.50 ms | 52.00 / 194.40 ms | 117.26 / 336.05 ms | PASS |
| entry: cold session from Home | 1069.80 / 1227.00 ms | 578.80 / 688.20 ms | 1176.78 / 1349.70 ms | PASS |

Complete measured distributions (canonical run, 20 samples each):

```text
tab switch: cold, review closed
  firstCorrect: [340.8, 285.8, 326, 284.8, 395.4, 303.2, 323.4, 276.7, 297.8, 284.3, 320.9, 304.4, 365, 291.6, 375.7, 285.3, 356.2, 314, 318.1, 339.6]
  stable:       [400.7, 330.3, 371.9, 331.1, 440.8, 356.2, 362.5, 320.8, 334.3, 330.5, 368.1, 354.9, 425, 352.5, 423.8, 333.5, 397.6, 367, 366.2, 382.1]
tab switch: warm, review closed
  firstCorrect: [48.7, 49.9, 52, 42, 42.5, 46, 46.5, 42.9, 45.5, 48.4, 42.8, 43.5, 39.5, 43.2, 40.7, 39.7, 39.7, 48.9, 46, 52.5]
  stable:       [180, 169.7, 172.9, 107.3, 165.4, 173.7, 159.9, 158.9, 168.2, 163.2, 100.7, 194.4, 157.8, 103.5, 106.3, 155.7, 152.7, 165, 179.1, 216.6]
entry: cold session from Home
  firstCorrect: [617.8, 513.7, 577.3, 522.1, 526.6, 565.5, 517.7, 552.4, 559.9, 527.3, 520.7, 578.8, 519.7, 515.8, 512.4, 536.7, 519.4, 510.7, 573.6, 507.4]
  stable:       [765.7, 587.9, 649.5, 657.6, 595.2, 644.2, 658.9, 688.2, 642.9, 604.3, 656.1, 656.1, 659.5, 585.5, 579.4, 667.9, 652.8, 576.9, 642.7, 584.3]
```

## Data-arrival-to-visible-render budget (100 tasks / 50 descendants)

The real Execution Map is mounted in the production app; a status-only report is delivered to the disposable
host; the page-level `fetch` boundary records when the `getRun` response resolves; a `MutationObserver`
records when the real map node's `data-state` becomes `running`. 12 samples.

```text
statusUpdateP95Ms: 10.2   (samples 12, tasks 100, descendants 50, budget ≤ 100 ms)
distribution: [8.5, 8.2, 10.2, 10.2, 7.7, 9.3, 4.6, 4.4, 4.3, 4.1, 4.1, 4.4]
```

## Browser long-task budget (closed dashboard)

`PerformanceObserver({ type: "longtask", buffered: true })` in the production app, over a deterministic
`page.clock.fastForward(60_000)` steady-state window with the dashboard closed (page-boot tasks excluded by an
in-page warm-up and a stable-count drain). Same window with the plugin loaded (closed) and unloaded (baseline):

```text
closed:   { supported: true, samples: 0, overThreshold: 0, maxDurationMs: 0, durations: [] }
baseline: { supported: true, samples: 0, overThreshold: 0, maxDurationMs: 0, durations: [] }
```

No long task above 50 ms in either state; the closed count is not greater than baseline → PASS.

## Polling and open/close lifecycle (browser)

```text
an unopened execution dashboard performs no interval polling
  {"closedDashboardFullRunPolls":0,"visibleDashboardFullRunPolls":4,"closedPollWindowMs":60000,"mountedGraphNodes":0}
fifty execution open and close cycles leave no mounted graph
  {"openCloseCycles":50,"mountedGraphNodes":0,"maxMountedGraphNodes":100}
```

`page.clock` drives the bridge's 15 s safety interval deterministically; event-driven reconciles from toggling
visibility are drained before the closed window is sampled, so the metric isolates interval polling.

## Paired session-layer benchmarks (`bench:tabs`, `bench:entry`)

Re-run on the final tree against the T01 recorded baseline (p95):

| Scenario | T01 baseline (firstCorrect / stable) | T19 final (firstCorrect / stable) | Delta |
|---|---|---|---|
| tab switch: cold, review closed | 530.90 / 583.00 ms | 343.70 / 399.70 ms | −35.3 % / −31.4 % |
| tab switch: cold, review open | 657.50 / 759.80 ms | 396.20 / 426.40 ms | −39.7 % / −43.9 % |
| tab switch: warm, review closed | 106.60 / 305.50 ms | 74.90 / 189.10 ms | −29.7 % / −38.1 % |
| tab switch: warm, review open | 200.70 / 434.70 ms | 122.10 / 246.10 ms | −39.2 % / −43.4 % |
| tab switch: warm, review resized | 246.80 / 365.70 ms | 182.50 / 308.70 ms | −26.1 % / −15.6 % |
| entry: cold session from Home | 1069.80 / 1227.00 ms | 702.00 / 798.10 ms | −34.4 % / −34.9 % |

`bench:tabs`: 100 passed (9.1 m), exit 0. `bench:entry`: 20 passed / 40 failed (6.6 m), exit 1; the two
failing scenarios fail before recording metrics on the pre-existing `session-entry-benchmark.spec.ts:47`
`expect(writes).toEqual([])` assertion, identical to the T01/T17 record. No scenario regressed by more
than 10 %.

## Gated checks

```text
$ cd packages/app
$ bun test --conditions=solid --preload ./happydom.ts ./src/superpowers
 190 pass / 0 fail

$ cd packages/app
$ bun run typecheck            # tsgo -b
(exit 0)

$ bun x oxlint packages/app/src/superpowers/lifecycle.ts \
    packages/app/src/superpowers/lifecycle.test.ts \
    packages/app/e2e/performance/superpowers/execution-benchmark.spec.ts
Found 0 warnings and 0 errors.

$ cd packages/app
$ PLAYWRIGHT_BUILD=1 EXECUTION_E2E_TARGET=... bun run test:e2e --config e2e/performance/playwright.config.ts \
    superpowers/execution-benchmark.spec.ts --workers=1
 7 passed (2.1m)

$ cd packages/app && EXECUTION_E2E_TARGET=... bun run test:e2e e2e/superpowers/execution.spec.ts --workers=1
 20 passed (3.1m); execution credential artifact scan: clean (2 files)
```

Raw output references (lossless canonical artifacts are committed):

- canonical BENCHMARK records: `docs/superpowers/verification/execution-ui/artifacts/t19-execution-benchmark.jsonl` (7 records)
- lifecycle unit run: `/tmp/opencode/t19-lifecycle-tests.log`
- `bench:tabs`: `/tmp/opencode/t19-bench-tabs-final.log`; raw records `packages/app/e2e/test-results/performance/tab-switch-benchmark.jsonl`
- `bench:entry`: `/tmp/opencode/t19-bench-entry-final.log`; raw records `packages/app/e2e/test-results/performance/tab-switch-benchmark.jsonl`
- T18 lifecycle e2e re-run: `/tmp/opencode/t19-t18-e2e.log`

## Release blocker found and fixed

The first paired runs measured a 20–29 % closed-dashboard entry regression. Root cause:
`createSessionExecutionModel` hydrated the root + 50 descendants (~153 native requests) on every session
entry even with the Execution tab closed. Fix (`packages/app/src/superpowers/session-execution.tsx`): gate the
native descendant hydration on the same `executionVisible` predicate the bridge already uses; bridge discovery
is unchanged so closed-dashboard failure tracking is preserved. Subsequent review round replaced the ad-hoc
gate with the recorded T01 scenarios above. No threshold was raised.

## Unrun gates

| Gate | Exact command | Outcome |
|---|---|---|
| Windows Desktop smoke (AC20) | Windows host required | UNRUN; T20 owns it. |
| Built companion package outside the monorepo (AC19) | package staging/load | UNRUN here; T20 owns packaging. The T19 e2e uses the T18 stand-in. |
| Root canonical check | `bun run check` (repo root) | Pre-existing `@opencode/posts#typecheck` / `@opencode/www#typecheck` failures (recorded by T13/T17); `packages/app` typecheck exits 0. |

## Files changed

- `packages/app/src/superpowers/lifecycle.ts` (new)
- `packages/app/src/superpowers/lifecycle.test.ts` (new)
- `packages/app/e2e/performance/superpowers/execution-benchmark.spec.ts` (new)
- `packages/app/src/superpowers/session-execution.tsx` (lazy dormant native hydration)
- `docs/superpowers/verification/execution-ui/artifacts/t19-execution-benchmark.jsonl` (new, lossless raw records)
- `docs/superpowers/verification/execution-ui/performance.md` (this file)

No new code comments were added (R-F3) and no `any` was used.
