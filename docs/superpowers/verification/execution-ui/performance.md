# Task 19 verification: performance budgets and lifecycle cleanup

Spec coverage: AC18. Authority: spec §13 and §6.3.

## Environment

| Item | Value |
|---|---|
| Branch | `execution-ui` |
| Base | `v2` at `c555559ac1b94910b769eebaa595b2b8822efa14` (OpenCode 2.0.11) |
| Measured working tree | Final whole-branch fix wave on top of T20, including automatic run rediscovery, confirmed native ancestry, presentation-aware reconciliation, and visibility-gated detailed activity loading |
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

### Step 4 GREEN (final verification; see `/tmp/opencode/final-fix-app-superpowers.log`)

```text
$ cd packages/app
$ bun test --conditions=solid --preload ./happydom.ts ./src/superpowers
[task-19-perf] rendering={"graphLayout500Ms":13.4598...,"graphLayout500P95Ms":13.4598...,"graphLayoutsForTokenOnlyUpdates":0,"graphLayoutsForLongTitles":0,"retainedNodes":500}
[task-19-lifecycle] rendering={"graphLayout500Ms":13.3152...,"graphLayout500P95Ms":13.3152...,"graphLayoutsForTokenOnlyUpdates":0,"graphLayoutsForLongTitles":0,"retainedNodes":500}
[task-19-lifecycle] baseline=0 listeners=0 intervals=0 cache=0 concurrent=1 closedPolls=0
  200 pass / 0 fail
```

| Target (§13) | Measured | Result |
|---|---|---|
| 500-task graph layout: every cold run ≤ 250 ms | max cold run 13.32–13.46 ms over 5 runs | PASS |
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
| tab switch: cold, review closed | 530.90 / 583.00 ms | 391.70 / 442.40 ms | 583.99 / 641.30 ms | PASS |
| tab switch: warm, review closed | 106.60 / 305.50 ms | 63.30 / 218.80 ms | 117.26 / 336.05 ms | PASS |
| entry: cold session from Home | 1069.80 / 1227.00 ms | 682.70 / 759.70 ms | 1176.78 / 1349.70 ms | PASS |

Complete measured distributions (canonical run, 20 complete pairs each):

```text
tab switch: cold, review closed
  firstCorrect: [305.4, 338, 334.4, 285.7, 285.7, 324.3, 341.4, 283.1, 391.7, 328.2, 315.7, 389, 288.3, 341.9, 343.3, 272.3, 348.9, 276.7, 316.1, 417.9]
  stable:       [344.3, 390.4, 385.6, 337.4, 353.2, 363.2, 397, 337.6, 442.4, 419.3, 385.8, 433.5, 339.9, 384.4, 398.2, 321.3, 399.7, 324.5, 388.9, 482]
tab switch: warm, review closed
  firstCorrect: [51, 50.1, 44.6, 65.9, 46.5, 63.3, 57, 52.2, 47.3, 60, 42.5, 45.6, 43.4, 52.2, 55.2, 45.6, 52.7, 50.4, 58.8, 62.3]
  stable:       [180.6, 187.3, 157.8, 154.7, 172, 200, 218.8, 186.9, 166.4, 195.8, 111.6, 161, 106.2, 181.1, 131.3, 179.4, 233.3, 173.5, 215.5, 211.6]
entry: cold session from Home
  firstCorrect: [682.7, 569, 558.6, 572.2, 494.7, 513.4, 487.1, 546.6, 559.8, 550.8, 537.2, 535.3, 553.6, 572.7, 528.9, 527.5, 592.5, 690.4, 537.4, 576.4]
  stable:       [768.2, 651.4, 635.1, 579.8, 574.1, 581.1, 610.6, 611.9, 637.3, 643.1, 604.3, 607.7, 696.1, 709.3, 598.5, 604.1, 677.9, 759.7, 683.4, 581.8]
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
| tab switch: cold, review closed | 70 / 70 | 0 | 20 / 19 | 0 |
| tab switch: warm, review closed | 26 / 23 | 0 | 15 / 12 | 0 |
| entry: cold session from Home | 42 / 42 | 0 | 11 / 11 | 0 |

Attribution is `self` / `window` for every record in both states
(`attributionSources: ["self|window::"]`). No final-run long task overlaps an Execution RPC window. This
excludes direct synchronous overlap in this run but does not establish a causal feature-absent comparison.

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
statusUpdateP95Ms: 10.8   (budget ≤ 100 ms)
distribution: [9, 8.2, 9.5, 7.3, 10.8, 6.3, 8.6, 8.6, 5.6, 7.9, 5.5, 4.8]
```

## Polling and open/close lifecycle (browser)

```text
an unopened execution dashboard performs no interval polling
  {"closedDashboardFullRunPolls":0,"visibleDashboardFullRunPolls":5,"closedPollWindowMs":60000,"mountedGraphNodes":0}
fifty execution open and close cycles leave no mounted graph
  {"openCloseCycles":50,"mountedGraphNodes":0,"maxMountedGraphNodes":100}
```

`page.clock` drives the bridge's 15 s safety interval deterministically; event-driven reconciles from toggling
visibility are drained before the closed window is sampled.

## Paired session-layer benchmarks (`bench:tabs`, `bench:entry`)

| Scenario | T01 baseline (firstCorrect / stable) | T19 final (firstCorrect / stable) | Delta |
|---|---|---|---|
| tab switch: cold, review closed | 530.90 / 583.00 ms | 425.40 / 594.90 ms | −19.9 % / +2.0 % |
| tab switch: cold, review open | 657.50 / 759.80 ms | 488.10 / 553.20 ms | −25.8 % / −27.2 % |
| tab switch: warm, review closed | 106.60 / 305.50 ms | 91.20 / 238.20 ms | −14.4 % / −22.0 % |
| tab switch: warm, review open | 200.70 / 434.70 ms | 144.20 / 284.10 ms | −28.2 % / −34.6 % |
| tab switch: warm, review resized | 246.80 / 365.70 ms | 207.40 / 348.20 ms | −16.0 % / −4.8 % |
| entry: cold session from Home | 1069.80 / 1227.00 ms | 851.30 / 983.40 ms | −20.4 % / −19.9 % |

`bench:tabs`: 100 passed (9.8 m), exit 0. `bench:entry`: 20 passed / 40 failed (6.9 m), exit 1; the two
failing scenarios fail on the pre-existing `session-entry-benchmark.spec.ts:47` assertion, identical to the
T01/T17 record.

## Gated checks

```text
$ cd packages/app
$ bun test --conditions=solid --preload ./happydom.ts ./src/superpowers
  200 pass / 0 fail

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
- lifecycle unit run: `/tmp/opencode/final-fix-app-superpowers.log`
- `bench:tabs`: `/tmp/opencode/final-fix-post-tabs.log`
- `bench:entry`: `/tmp/opencode/final-fix-post-entry.log`

## Final visibility behavior

The final implementation keeps native root/descendant hydration active while the Execution presentation is
closed because header attention and native telemetry depend on it. Actual presentation visibility gates only
the 15-second full-run reconciliation interval and detailed per-agent message activity requests. Visibility
requires the active Session owner and visible document plus either the open desktop panel with the Execution
tab active, expanded presentation, or the mobile Execution view. Detailed activity loads only for virtualized
visible agent rows with at most four concurrent requests. No threshold was raised.

## Gate status

| Gate | Exact command / reason | Outcome |
|---|---|---|
| Feature-attributable long task (closed dashboard) | Chromium reports only self/window attribution; asynchronous RPC-window overlap attributes unrelated render tasks; no feature-absent build available for a causal difference | UNRUN (raw profiles preserved); see above |
| Windows Desktop smoke (AC20) | Windows host, explicit test server (`bun run dev --download-server 2.0.11`) | PASS (`release-checklist.md` §7). |
| Root canonical check | `bun run check` (repo root) | Pre-existing `@opencode/posts#typecheck` / `@opencode/www#typecheck` failures (recorded by T13/T17); `packages/app` typecheck exits 0. |

## Files changed

- `packages/app/src/superpowers/lifecycle.ts` (new)
- `packages/app/src/superpowers/lifecycle.test.ts` (new)
- `packages/app/e2e/performance/superpowers/execution-benchmark.spec.ts` (new)
- `packages/app/src/superpowers/session-execution.tsx` (lazy dormant native hydration)
- `docs/superpowers/verification/execution-ui/artifacts/t19-execution-benchmark.jsonl` (new)
- `docs/superpowers/verification/execution-ui/performance.md` (this file)

No new code comments were added (R-F3) and no `any` was used.
