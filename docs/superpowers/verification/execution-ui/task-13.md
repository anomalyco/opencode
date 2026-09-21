# Task 13 verification: stable dependency map

## Environment

| Item | Value |
|---|---|
| Bun | 1.4.2 |
| Branch | execution-ui |
| Package | `packages/app` |
| Fixture size | 21 focused `graph-layout.test.ts` tests; 60 `superpowers.spec.ts` component tests |
| Map fixture | diamond DAG (`schema → api → tests → final-review`, `schema → cli`); 250-task grouped fixture |
| Layout micro-benchmark | 500 tasks, 480 edges, per-task measured heights (layers of 20 columns x 25) |

## Step 2: RED

```text
$ cd packages/app
$ bun test --conditions=solid --preload ./happydom.ts ./src/superpowers/graph-layout.test.ts
bun test v1.4.2 (744846f84)

src/superpowers/graph-layout.test.ts:
# Unhandled error between tests
error: Cannot find module './graph-layout' from '.../graph-layout.test.ts'
 0 pass
 1 fail
 1 error
```

## Step 4: GREEN

```text
$ cd packages/app
$ bun test --conditions=solid --preload ./happydom.ts ./src/superpowers/graph-layout.test.ts
 21 pass
 0 fail
 83 expect() calls
Ran 21 tests across 1 file. [329.00ms]
```

```text
$ cd packages/app
$ bun run test:components component-tests/superpowers.spec.ts --grep "map" --workers=2
 11 passed (2.9m)

$ bun run test:components component-tests/superpowers.spec.ts --workers=2
 60 passed (2.4m)
```

```text
$ cd packages/app
$ bun run typecheck
$ tsgo -b
(exit 0)
```

```text
$ bun test --conditions=solid --preload ./happydom.ts ./src
 983 pass
 1 skip
 0 fail
 3107 expect() calls
Ran 984 tests across 136 files. [5.11s]
```

```text
$ oxlint (repo root)
Found 0 warnings and 0 errors.
Finished in 314ms on 4223 files with 1 rules using 12 threads.
```

## Section 13 layout measurements (T13 share of AC18)

Measured by the focused micro-benchmark test
`layoutTaskGraph > records the 500-task layout and status-update budgets`
(`src/superpowers/graph-layout.test.ts`). It builds a 500-task / 480-edge DAG with
per-task measured heights, takes the minimum of five cold-cache
`layoutTaskGraph` runs, then takes the minimum of five
`cachedLayout` status-only runs over the same data, and asserts the §13 targets.

```text
$ cd packages/app
$ bun test --conditions=solid --preload ./happydom.ts ./src/superpowers/graph-layout.test.ts
[task-13-perf] layout500min=0.87ms runs=2.12,1.13,2.39,1.18,0.87 statusUpdate=0.114ms
(pass) layoutTaskGraph > records the 500-task layout and status-update budgets [11.81ms]
```

| Target (§13) | Measured | Result |
|---|---|---|
| Full 500-task graph layout <= 250 ms | 0.87 ms (min of 5 runs; slowest cold run 2.39 ms) | PASS |
| Status-only update <= 100 ms | 0.114 ms (cache hit, no relayout) | PASS |

These are Node/Bun-side pure layout timings on this worktree's development machine, not
browser paint or network latency. The 500-task graph stays under the map's grouped threshold
only for the narrow-scan cases; the production map switches to the grouped/list fallback above
200 visible nodes, which is the specified behavior when a graph would not stay responsive.

## Interaction/accessibility verification

- `map grows measured height for an expanded task title` and
  `map relayouts when accessibility text size increases` exercise the computed-typography
  measurement path: raising the map root font size dispatches `resize`, the dimension
  signature changes, and nodes are re-measured/re-laid-out.
- `map mounts only while the Map subview is selected` plus the existing
  `execution tab mounts the graph only while open` show the map is not mounted (and the
  `execution-map` module is only dynamically imported) until the Map subview is selected.
- `map does not recenter or relayout when a task status changes` confirms status-only updates
  neither relayout nor move the viewport.

## Unrun gates

| Gate | Exact command | Outcome |
|---|---|---|
| Root canonical check | `bun run check` (repo root) | FAIL (pre-existing, unrelated): `@opencode/posts#typecheck` -> `astro check` -> `Tsconfig not found @tsconfig/bun/tsconfig.json`; also `@opencode/www#typecheck`. Not caused by T13; app `typecheck` exits 0. |
| Live-server map run | manual `bun run dev:live` | UNRUN: T13 is fixture/component tested per the brief; no live server was started. |
| Browser paint benchmark | production-mode build + recorded settings | UNRUN: §13's paired paint benchmark is owned by T19; T13 records the pure layout half only. |
