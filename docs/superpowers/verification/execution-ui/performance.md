# Task 19 verification: performance budgets and lifecycle cleanup

Spec coverage: AC18. Authority: spec §13 and §6.3.

## Environment

| Item | Value |
|---|---|
| Branch | `execution-ui` |
| Base | `v2` at `c555559ac1b94910b769eebaa595b2b8822efa14` (OpenCode 2.0.11) |
| Measured working tree | T19 commits `perf(app): enforce execution rendering and lifecycle budgets`, `fix(app): address execution performance review findings`, `fix(app): enforce paired gates and browser long-task attribution`, and the T01-scenario long-task round (base `fb485c3d5ec4b175d22f61fe4153592f0efd7a46`) |
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
| Render budgets | `measureGraphBudgets()` DAG | 500 tasks / 480 edges; long-title variant |
| Retained events | `createExecutionModel` activity projection | 1,000 events, page size 100 |
| Closed-dashboard host tasks | disposable host `run.start` | 100 tasks (flat, status-transitionable) |
| Closed-dashboard host sessions | disposable host `sessions` control | root + 50 descendants + 1 plain session |
| T01 tab-switch gate | `session-tab-switch.fixture` + stress tabs | 2 sessions, 200 exchanges / 400 messages each |
| T01 Home-entry gate | `session-timeline-stress.fixture` | Home → cold session |

## Unit lifecycle budgets

### Step 2 RED (before implementation)

```text
$ cd packages/app
$ bun test --conditions=solid --preload ./happydom.ts ./src/superpowers/lifecycle.test.ts
error: Cannot find module './lifecycle' from '.../lifecycle.test.ts'
 0 pass / 1 fail / 1 error
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
| 500-task graph layout: every cold run ≤ 250 ms | max cold run 1.14–4.19 ms over 5 runs | PASS |
| No relayout for token/status-only updates | `graphLayoutsForTokenOnlyUpdates = 0`; retained nodes stayed 500 | PASS |
| No relayout for long titles | `graphLayoutsForLongTitles = 0` | PASS |
| 1,000 retained events stay bounded | activity page holds 100 of 1,000 with `hasMore` | PASS |
| Listeners return to baseline after 50 open/close and 50 root switches | 0 → 0 | PASS |
| Intervals return to baseline | 0 | PASS |
| Run cache ≤ 20 within one scope | 20 after 25 distinct runs | PASS |
| Detail fetches concurrent ≤ 4 (50 descendants) | 4 | PASS |
| Hidden dashboard makes no interval full-run poll | 0 over 10 intervals | PASS |
| Hiding the tab suspends and resuming restores the single safety interval | 1 → 0 → 1 | PASS |

## T01 session-switch gates (AC18 regression target)

The 10% gate uses the recorded T01 scenarios and first-correct/stable timeline milestones, comparing measured
p95 against the recorded pre-feature T01 p95 (`baseline.md`) × 1.10. Each scenario requires exactly **20
complete observations**; a missing milestone for any repeat fails with the offending indices and no null is
dropped.

```text
$ cd packages/app
$ bun run test:e2e --config e2e/performance/playwright.config.ts superpowers/execution-benchmark.spec.ts --workers=1
 3 passed
 3 skipped          # disposable-host gates UNRUN without EXECUTION_E2E_TARGET

$ cd packages/app
$ PLAYWRIGHT_BUILD=1 EXECUTION_E2E_TARGET='{"disposable":true,"directory":"/tmp/opencode/execution-perf","port":4611}' \
    bun run test:e2e --config e2e/performance/playwright.config.ts \
    superpowers/execution-benchmark.spec.ts --workers=1
 6 passed (5.0m)
```

| Scenario | T01 recorded p95 (firstCorrect / stable) | Measured p95 (firstCorrect / stable) | Budget (×1.10) | Result |
|---|---|---|---|---|
| tab switch: cold, review closed | 530.90 / 583.00 ms | 330.20 / 367.90 ms | 583.99 / 641.30 ms | PASS |
| tab switch: warm, review closed | 106.60 / 305.50 ms | 49.70 / 180.10 ms | 117.26 / 336.05 ms | PASS |
| entry: cold session from Home | 1069.80 / 1227.00 ms | 617.90 / 699.40 ms | 1176.78 / 1349.70 ms | PASS |

Complete measured distributions (canonical run, 20 complete pairs each):

```text
tab switch: cold, review closed
  firstCorrect: [369, 271.8, 296.9, 299.1, 288.3, 278.5, 302.8, 313.6, 330.2, 296.6, 260.2, 312.8, 288.7, 278.5, 310.5, 292.8, 290.3, 303, 273.1, 293.3]
  stable:       [442.6, 321.9, 333.9, 306.2, 327.8, 329.5, 347.7, 322.9, 367.9, 346.1, 304, 321.6, 337.5, 323, 358.8, 301.3, 345.8, 347.2, 329.9, 345]
tab switch: warm, review closed
  firstCorrect: [58.4, 49.7, 49.2, 49, 44.7, 49, 45.5, 48, 45.3, 43, 42.3, 44.9, 44.2, 42.5, 44.1, 43.5, 43.2, 43.2, 41.5, 42.5]
  stable:       [124.1, 171.7, 168.4, 180.1, 109.2, 167.7, 163.7, 125.4, 185, 109.2, 102.8, 110.6, 162.7, 102.4, 163.8, 100.8, 103.5, 148.5, 98.6, 98]
entry: cold session from Home
  firstCorrect: [617.9, 600.2, 504.5, 506.5, 625.3, 520.8, 525.7, 519.1, 552.3, 504.3, 484.6, 515.1, 523.5, 491.4, 506.6, 491.5, 519.7, 525, 462.6, 487]
  stable:       [746.1, 675.4, 638.6, 587.1, 699.4, 656.1, 529.1, 597.1, 695.6, 573, 554.6, 580.4, 654.9, 570.6, 574.7, 558.8, 661, 593.2, 541.7, 625.3]
```

## Long-task observation on the T01 scenarios

`PerformanceObserver({ type: "longtask", buffered: true })` runs inside the actual T01 scenarios (cold tab
switch, warm tab switch, Home entry), after a discarded warm-up navigation. Every execution RPC
(`/api/rpc/superpowers.execution.v1/**`) is bracketed in the page fetch boundary with `performance.mark` and
`performance.measure` (`execution-window-N`). Each long task records `name`, `duration`, `startTime`,
Chromium attribution, whether its interval overlaps an execution-RPC window, and the overlapping window names.
The same scenario is then re-run with the execution RPCs aborted (`page.route(EXECUTION_RPC_PATTERN,
route => route.abort())`) as an in-run feature-network-disabled baseline.

| Scenario | current samples / >50 ms | current feature-attributable | baseline samples / >50 ms | baseline feature-attributable |
|---|---|---|---|---|
| tab switch: cold, review closed | 63 / 63 | 3 (all 60–64 ms) | 19 / 19 | 0 |
| tab switch: warm, review closed | 5 / 4 | 0 | 5 / 5 | 0 |
| entry: cold session from Home | 36 / 36 | 0 | 9 / 9 | 0 |

Attribution is `self` / `window` for every record in both states
(`attributionSources: ["self|window::"]`). The three feature-attributable cold records are 60–64 ms tasks
starting at `560.9–564.5 ms`, overlapping `execution-window-1` — a `getSummaries` fetch that completed in
~10 ms while the timeline was rendering. The execution windows themselves are recorded with
`performance.measure` (for example cold document `…-g82plcic9y`: `getSummaries` 309.3→322.3 ms, `capabilities`
522.5→651.1 ms), showing that the flagged tasks coincide with an in-flight asynchronous fetch rather than with
synchronous feature work.

**Feature-attribution gate: UNRUN.** `featureAttributionGate: "unrun"`. Reason: *Chromium long tasks report
only self/window attribution; overlap with asynchronous execution RPC windows attributes unrelated
boot/timeline render tasks, and no feature-absent build is available at runtime for a causal difference.* A
causal bound would require a feature-absent counterfactual build (the recorded T01 baseline contains no
long-task records), which is not produced in this environment. The long-task profiles and every raw record
(with attribution and the measured execution windows) are preserved in
`artifacts/t19-execution-benchmark.jsonl`.

## Data-arrival-to-visible-render budget (100 tasks / 50 descendants)

Real Execution Map mounted in the production app; status-only report delivered to the disposable host; the
page `fetch` boundary timestamps the `getRun` response; a `MutationObserver` records the map node's
`data-state` mutation. 12 samples.

```text
statusUpdateP95Ms: 11.5   (budget ≤ 100 ms)
distribution: [11.5, 10, 7.1, 9.3, 6.8, 7.7, 5.5, 5.1, 5.6, 4.7, 5.3, 6.1]
```

## Polling and open/close lifecycle (browser)

```text
an unopened execution dashboard performs no interval polling
  {"closedDashboardFullRunPolls":0,"visibleDashboardFullRunPolls":4,"closedPollWindowMs":60000,"mountedGraphNodes":0}
fifty execution open and close cycles leave no mounted graph
  {"openCloseCycles":50,"mountedGraphNodes":0,"maxMountedGraphNodes":100}
```

`page.clock` drives the bridge's 15 s safety interval deterministically; event-driven reconciles from toggling
visibility are drained before the closed window is sampled.

## Paired session-layer benchmarks (`bench:tabs`, `bench:entry`)

| Scenario | T01 baseline (firstCorrect / stable) | T19 final (firstCorrect / stable) | Delta |
|---|---|---|---|
| tab switch: cold, review closed | 530.90 / 583.00 ms | 343.70 / 399.70 ms | −35.3 % / −31.4 % |
| tab switch: cold, review open | 657.50 / 759.80 ms | 396.20 / 426.40 ms | −39.7 % / −43.9 % |
| tab switch: warm, review closed | 106.60 / 305.50 ms | 74.90 / 189.10 ms | −29.7 % / −38.1 % |
| tab switch: warm, review open | 200.70 / 434.70 ms | 122.10 / 246.10 ms | −39.2 % / −43.4 % |
| tab switch: warm, review resized | 246.80 / 365.70 ms | 182.50 / 308.70 ms | −26.1 % / −15.6 % |
| entry: cold session from Home | 1069.80 / 1227.00 ms | 702.00 / 798.10 ms | −34.4 % / −34.9 % |

`bench:tabs`: 100 passed (9.1 m), exit 0. `bench:entry`: 20 passed / 40 failed (6.6 m), exit 1; the two
failing scenarios fail on the pre-existing `session-entry-benchmark.spec.ts:47` assertion, identical to the
T01/T17 record.

## Gated checks

```text
$ cd packages/app
$ bun test --conditions=solid --preload ./happydom.ts ./src/superpowers
 190 pass / 0 fail

$ cd packages/app && bun run typecheck     # tsgo -b
 (exit 0)

$ bun x oxlint packages/app/src/superpowers/lifecycle.ts \
    packages/app/src/superpowers/lifecycle.test.ts \
    packages/app/e2e/performance/superpowers/execution-benchmark.spec.ts
Found 0 warnings and 0 errors.

$ cd packages/app && EXECUTION_E2E_TARGET=... bun run test:e2e e2e/superpowers/execution.spec.ts --workers=1
 20 passed (3.1m); execution credential artifact scan: clean (2 files)
```

Raw output references (lossless canonical artifacts are committed):

- canonical BENCHMARK records: `docs/superpowers/verification/execution-ui/artifacts/t19-execution-benchmark.jsonl` (6 records, including full distributions, measured execution windows, and per-scenario long-task records with attribution)
- lifecycle unit run: `/tmp/opencode/t19-lifecycle-tests.log`
- `bench:tabs`: `/tmp/opencode/t19-bench-tabs-final.log`; raw records `packages/app/e2e/test-results/performance/tab-switch-benchmark.jsonl`
- `bench:entry`: `/tmp/opencode/t19-bench-entry-final.log`; raw records `packages/app/e2e/test-results/performance/tab-switch-benchmark.jsonl`

## Release blocker found and fixed

The first paired runs measured a 20–29 % closed-dashboard entry regression; root cause was eager native
descendant hydration while the Execution tab was closed. Fix: gate native hydration on `executionVisible`
(`session-execution.tsx`). Later rounds replaced the ad-hoc gate with the recorded T01 scenarios, enforced
complete paired observations, and moved long-task observation onto the T01 scenarios with explicit
`performance.mark`/`measure` execution-RPC windows. No threshold was raised.

## Unrun gates

| Gate | Exact command / reason | Outcome |
|---|---|---|
| Feature-attributable long task (closed dashboard) | Chromium reports only self/window attribution; asynchronous RPC-window overlap attributes unrelated render tasks; no feature-absent build available for a causal difference | UNRUN (raw profiles preserved); see above |
| Windows Desktop smoke (AC20) | Windows host required | UNRUN; T20 owns it. |
| Built companion package outside the monorepo (AC19) | package staging/load | UNRUN here; T20 owns packaging. |
| Root canonical check | `bun run check` (repo root) | Pre-existing `@opencode/posts#typecheck` / `@opencode/www#typecheck` failures (recorded by T13/T17); `packages/app` typecheck exits 0. |

## Files changed

- `packages/app/src/superpowers/lifecycle.ts` (new)
- `packages/app/src/superpowers/lifecycle.test.ts` (new)
- `packages/app/e2e/performance/superpowers/execution-benchmark.spec.ts` (new)
- `packages/app/src/superpowers/session-execution.tsx` (lazy dormant native hydration)
- `docs/superpowers/verification/execution-ui/artifacts/t19-execution-benchmark.jsonl` (new)
- `docs/superpowers/verification/execution-ui/performance.md` (this file)

No new code comments were added (R-F3) and no `any` was used.
