# Task 19 verification: performance budgets and lifecycle cleanup

Spec coverage: AC18. Authority: spec §13 and §6.3.

## Environment

| Item | Value |
|---|---|
| Branch | `execution-ui` |
| Base | `v2` at `c555559ac1b94910b769eebaa595b2b8822efa14` (OpenCode 2.0.11) |
| Measured working tree | T19 commit `perf(app): enforce execution rendering and lifecycle budgets` (base `fb485c3d5ec4b175d22f61fe4153592f0efd7a46`) |
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
| Render/status budget tasks | `measureGraphBudgets()` DAG | 500 tasks / 480 edges; 100-task status set |
| Retained events | `createExecutionModel` activity projection | 1,000 events, page size 100 |
| Closed-dashboard benchmark tasks | disposable host `run.start` | 100 tasks / 99 dependencies |
| Closed-dashboard benchmark sessions | disposable host `sessions` control | root + 50 descendants + 1 plain session |

`lifecycleHarness` wires the **actual** feature instances — `createSessionExecution` (bridge + model) and
`createNativeExecutionOwner` / `createNativeExecutionAdapter` — through injected event, clock, request, and
native-boundary fakes. Listener counts come from the injected event source; interval counts from the injected
clock; `maxConcurrentDetails` from the native boundary; `cacheSize` is probed through the bridge's public
`attach`/`getSnapshot` with the connection disabled so no network fetch perturbs the cache.

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

### Step 4 GREEN (after implementation)

```text
$ cd packages/app
$ bun test --conditions=solid --preload ./happydom.ts ./src/superpowers/lifecycle.test.ts
[task-19-perf] rendering={"graphLayout500Ms":0.9588...,"graphLayout500P95Ms":4.6223...,"graphLayoutsForTokenOnlyUpdates":0,"graphLayoutsForLongTitles":0,"retainedNodes":500,"statusUpdateP95Ms":0.0866...}
[task-19-lifecycle] rendering={"graphLayout500Ms":0.8038...,"graphLayout500P95Ms":5.0119...,"graphLayoutsForTokenOnlyUpdates":0,"graphLayoutsForLongTitles":0,"retainedNodes":500,"statusUpdateP95Ms":0.0541...}
[task-19-lifecycle] baseline=0 listeners=0 intervals=0 cache=0 concurrent=1 closedPolls=0 syncSpan=0.16
 12 pass / 0 fail / 33 expect() calls
```

| Target (§13) | Measured | Result |
|---|---|---|
| 500-task graph layout ≤ 250 ms | 0.80–0.96 ms min of 5 cold runs (p95 4.62–5.01 ms) | PASS |
| Status-only update p95 ≤ 100 ms (100 tasks) | 0.05–0.09 ms (50 status-only model updates) | PASS |
| No relayout for token/status-only updates | `graphLayoutsForTokenOnlyUpdates = 0`; retained nodes stayed 500 | PASS |
| No relayout for long titles | `graphLayoutsForLongTitles = 0` | PASS |
| 1,000 retained events stay bounded | activity page holds 100 of 1,000 with `hasMore` | PASS |
| Listeners return to baseline after 50 open/close and 50 root switches | 0 → 0 | PASS |
| Intervals return to baseline | 0 | PASS |
| Run cache ≤ 20 within one scope | 20 after 25 distinct runs (evicts oldest) | PASS |
| Detail fetches concurrent ≤ 4 (50 descendants) | 4 | PASS |
| No unopened-dashboard sync span > 50 ms | 0.16 ms max over 50 closed-view cycles | PASS |
| Hidden dashboard makes no interval full-run poll | 0 over 10 intervals | PASS |
| Hiding the tab suspends and resuming restores the single safety interval | 1 → 0 → 1 | PASS |

The 500-task layout figure is a pure Bun-side layout on this machine (matches T13's method); it is not browser
paint. `graphLayout500P95Ms` is included for the distribution; the acceptance value is the min-of-5 cold run.

## Closed-dashboard paired benchmark (AC18 regression target)

The regression target is measured **paired** in one run on the same machine/build/fixtures. Two states:
"base" = the same disposable host with the companion plugin unloaded (observer, no bridge discovery);
"closed" = real feature with the Execution tab closed. The measurement runs four phases in the order
`closed, base, base, closed` (a discarded warm-up navigation per phase) so drift and cold-start order bias
cancel; the pooled distributions are 60 samples each. The scenario alternates session entry between the root
session and a plain session.

```text
$ cd packages/app
$ EXECUTION_E2E_TARGET='{"disposable":true,"directory":"/tmp/opencode/execution-perf","port":4611}' \
    bun run test:e2e --config e2e/performance/playwright.config.ts \
    superpowers/execution-benchmark.spec.ts --workers=1
BENCHMARK ... "execution closed does not regress session entry or switch p95"
  metrics={"closedSessionSwitchP95Ms":415,"baselineSessionSwitchP95Ms":393,
           "closedSessionSwitchBudgetMs":432.3,"regressionRatio":1.06,"samples":60,"phases":2,
           "loadedDistribution":[...60 samples...],"baselineDistribution":[...60 samples...],
           "mountedGraphNodes":0}
 3 passed (…)
```

| Metric | Base (plugin unloaded) | Closed dashboard | Budget | Result |
|---|---|---|---|---|
| session entry/switch p95, 60 samples | 393 ms | 415 ms | ≤ 432.3 ms (base × 1.10) | PASS (ratio 1.06) |
| mounted graph nodes while closed | 0 | 0 | 0 | PASS |

Repeated 60-sample paired validation runs: ratios **1.10, 1.06, 1.03, 1.02** (all within the 10 % budget). The
bulk (median) distributions are equal; p95 differences are dominated by isolated WSL scheduler/GC samples
(for example a 1531 ms and a 1638 ms single sample appear in the base and closed distributions respectively).
Per §13, the paired measurement was repeated and the distribution is recorded rather than a single run.

T01's recorded values reference: `warm, review closed` stable p95 305.50 ms; `entry: cold session from Home`
stable p95 1227.00 ms. Those scenarios were re-run with the feature present (below) and did not regress.

## Release blocker found and fixed

The first paired runs (before the fix) measured a **20–29 %** closed-dashboard entry regression
(closed 419/432 ms vs base 335/347 ms, ratios 1.21/1.29). Root cause: `createSessionExecutionModel` called
`nativeExecution.refresh()` unconditionally on mount, so every session entry — even with the Execution tab
closed — hydrated the root plus all 50 descendants as 51 × (`session.get` + `permission.list` + `form.list`)
≈ 153 native requests.

Fix (`packages/app/src/superpowers/session-execution.tsx`): the native descendant hydration is now gated by
the same `executionVisible` predicate the bridge already uses for its safety timer, so a closed dashboard
performs no native hydration. The bridge discovery (capabilities / summaries / run snapshot) is unchanged, so
the closed-dashboard failure badge and the T18 "tracks failures while the Execution tab is closed" behavior
are preserved. Opening the Execution tab refreshes the native tree. After the fix the closed-dashboard ratio
is 1.02–1.10. This is the only feature-code modification; no threshold was changed.

## Polling and open/close lifecycle (browser)

```text
BENCHMARK ... "an unopened execution dashboard performs no interval polling"
  metrics={"closedDashboardFullRunPolls":0,"visibleDashboardFullRunPolls":4,
           "closedPollWindowMs":60000,"mountedGraphNodes":0}
BENCHMARK ... "fifty execution open and close cycles leave no mounted graph"
  metrics={"openCloseCycles":50,"mountedGraphNodes":0,"maxMountedGraphNodes":100}
```

`page.clock` drives the bridge's 15 s safety interval deterministically. With the Execution tab open one
interval produces a full-run poll; after closing the tab a 60 s fast-forward produces zero. Event-driven
reconciles caused by toggling visibility are drained before the closed window is sampled, so the metric
isolates interval polling. After 50 open/close cycles the graph is unmounted (0 nodes) while the open cycles
legitimately mount up to 100 nodes, proving the lazy mount is real rather than never mounting.

## Paired session-layer benchmarks (`bench:tabs`, `bench:entry`)

Re-run on the final tree against the T01 recorded baseline and the T17 comparison (p95):

| Scenario | T01 baseline (firstCorrect / stable) | T19 (firstCorrect / stable) | Delta |
|---|---|---|---|
| tab switch: cold, review closed | 530.90 / 583.00 ms | 338.10 / 390.20 ms | −36.3 % / −33.1 % |
| tab switch: cold, review open | 657.50 / 759.80 ms | 378.20 / 429.80 ms | −42.5 % / −43.4 % |
| tab switch: warm, review closed | 106.60 / 305.50 ms | 78.10 / 202.20 ms | −26.7 % / −33.8 % |
| tab switch: warm, review open | 200.70 / 434.70 ms | 118.80 / 240.70 ms | −40.8 % / −44.6 % |
| tab switch: warm, review resized | 246.80 / 365.70 ms | 139.30 / 270.40 ms | −43.6 % / −26.1 % |
| entry: cold session from Home | 1069.80 / 1227.00 ms | 669.00 / 771.90 ms | −37.5 % / −37.1 % |

`bench:tabs`: 100 passed (9.1 m), exit 0. `bench:entry`: 20 passed / 40 failed (6.6 m), exit 1; the two
failing scenarios fail before recording metrics on the pre-existing `session-entry-benchmark.spec.ts:47`
`expect(writes).toEqual([])` assertion, identical to the T01/T17 record. No scenario regressed by more
than 10 %.

## Gated checks

```text
$ cd packages/app
$ bun test --conditions=solid --preload ./happydom.ts ./src/superpowers
 191 pass / 0 fail / 690 expect() calls

$ cd packages/app
$ bun run typecheck            # tsgo -b
(exit 0)

$ bun x oxlint packages/app/src/superpowers/lifecycle.ts \
    packages/app/src/superpowers/lifecycle.test.ts \
    packages/app/e2e/performance/superpowers/execution-benchmark.spec.ts
Found 0 warnings and 0 errors.

$ cd packages/app && EXECUTION_E2E_TARGET=... bun run test:e2e e2e/superpowers/execution.spec.ts --workers=1
 20 passed (3.1m); execution credential artifact scan: clean (2 files)
```

Raw output references:

- lifecycle unit run: `/tmp/opencode/t19-lifecycle-tests.log`
- performance e2e (canonical full run): `/tmp/opencode/t19-execution-benchmark.log` (BENCHMARK JSON lines)
- entry paired validation runs: `/tmp/opencode/t19-entry-pair-{1,2,3}.log`
- `bench:tabs`: `/tmp/opencode/t19-bench-tabs-final.log`; raw records `packages/app/e2e/test-results/performance/tab-switch-benchmark.jsonl`
- `bench:entry`: `/tmp/opencode/t19-bench-entry-final.log`; raw records `packages/app/e2e/test-results/performance/tab-switch-benchmark.jsonl`
- T18 lifecycle e2e re-run: `/tmp/opencode/t19-t18-e2e.log`

## Unrun gates

| Gate | Exact command | Outcome |
|---|---|---|
| Windows Desktop smoke (AC20) | Windows host required | UNRUN; no Windows host in this environment. T20 owns it. |
| Built companion package outside the monorepo (AC19) | package staging/load | UNRUN here; T20 owns packaging. The T19 e2e uses the T18 stand-in. |
| Root canonical check | `bun run check` (repo root) | Pre-existing `@opencode/posts#typecheck` / `@opencode/www#typecheck` failures (recorded by T13/T17); `packages/app` typecheck exits 0. |

## Files changed

- `packages/app/src/superpowers/lifecycle.ts` (new)
- `packages/app/src/superpowers/lifecycle.test.ts` (new)
- `packages/app/e2e/performance/superpowers/execution-benchmark.spec.ts` (new)
- `packages/app/src/superpowers/session-execution.tsx` (lazy dormant native hydration)
- `docs/superpowers/verification/execution-ui/performance.md` (this file)

No new code comments were added (R-F3) and no `any` was used.
