# Test Suite Speed

## Goal

Speed up the `packages/opencode` test suite without reducing coverage or hiding failures.

## Benchmark Command

Run from `packages/opencode`:

```sh
bun run bench:test
```

The full-suite benchmark defaults to one measured run. Use repeated runs only after a targeted win:

```sh
BENCH_WARMUPS=1 BENCH_RUNS=3 bun run bench:test
```

To identify slow files, run:

```sh
bun run profile:test
```

Scope it while exploring:

```sh
TEST_PROFILE_GLOB='test/server/**/*.test.ts' bun run profile:test
TEST_PROFILE_LIMIT=20 bun run profile:test
```

## Primary Metric

`METRIC test_suite_seconds=<median wall clock seconds>`

## Secondary Metrics

`test_suite_best_seconds`, `test_suite_worst_seconds`, failures, and noisy spread.

For profiling: `slowest_test_file_seconds` and the slowest file list.

## Files In Scope

`packages/opencode/test/**`, test fixtures, package test scripts, and implementation setup paths only when a benchmarked bottleneck points there.

## Signals To Watch

Repeated setup work, long sleeps/timeouts, serial integration tests, filesystem/database fixture costs, and broad test globs pulling unrelated work.

## Hypothesis Loop

| Hypothesis                                                                                                | Change                                                                                         | Before    | After   | Decision | Notes                                                                                                                      |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------- | ------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| Repeated full-suite runs are too expensive for discovery                                                  | Switched full-suite benchmark to one run and added per-file profiler                           | ~250s/run | pending | keep     | Bun has no slowest-test reporter in this version; profile files directly.                                                  |
| Plugin install concurrency test spends time spawning more workers than needed to exercise lock contention | Reduced worker counts from 12/10/8 to 6/6/5; kept `holdMs: 30`                                 | 7.800s    | 6.204s  | keep     | Median from 3 targeted runs; still covers concurrent cross-process writes to server, server+tui, and existing json config. |
| `httpapi-listen` PTY route tests pay for git repositories they do not assert on                           | Removed `git: true` from temp dirs while keeping config setup                                  | 10.554s   | 7.818s  | keep     | Median from 3 targeted runs; HTTP routes, tickets, websocket upgrade, restart, and no-auth paths still pass.               |
| `workspace.waitForSync` timeout test waits the full production timeout                                    | Added optional timeout parameter defaulting to production timeout; timeout test uses 25ms      | 12.949s   | 8.305s  | keep     | Median from 3 targeted runs; production callers keep the 5000ms default.                                                   |
| `config.test` waits after dependencies even though `.gitignore` is written synchronously                  | Removed obsolete 1000ms sleep from writable `OPENCODE_CONFIG_DIR` test                         | 10.270s   | 9.433s  | keep     | Median from 5 targeted runs because one run was noisy; simpler test and no fixed sleep.                                    |
| SDK parity helpers create git repos for tests that only need files/config/session state                   | Changed `withProject` default to no git; explicit git init test still opts into no-git fixture | 8.011s    | 5.180s  | keep     | Median from 5 targeted runs because first run was cold/noisy.                                                              |
| Provider plugin filter test waits on plugin dependency readiness setup                                    | Marked local plugin dependencies ready using the existing fixture helper                       | 7.543s    | 6.366s  | keep     | Median from 3 targeted runs; matches neighboring plugin provider test setup.                                               |
| HTTP provider tests generate local plugins without dependency-ready fixture state                         | Marked generated `.opencode` plugin fixtures dependency-ready                                  | 7.905s    | 2.980s  | keep     | Median from 3 targeted runs; avoids unrelated plugin dependency setup in route tests.                                      |

## Profiling Results

Command shape:

```sh
TEST_PROFILE_GLOB='test/<area>/**/*.test.ts' TEST_PROFILE_TOP=15 bun run profile:test
```

Slowest files observed so far:

| File                                      | Seconds | Scope         |
| ----------------------------------------- | ------: | ------------- |
| `test/config/config.test.ts`              |  23.546 | config        |
| `test/provider/provider.test.ts`          |  18.747 | provider      |
| `test/control-plane/workspace.test.ts`    |  16.447 | control-plane |
| `test/plugin/install-concurrency.test.ts` |  14.804 | plugin        |
| `test/server/httpapi-cors.test.ts`        |  14.620 | server        |
| `test/server/httpapi-listen.test.ts`      |  10.073 | server        |
| `test/server/httpapi-sdk.test.ts`         |   8.661 | server        |
| `test/server/httpapi-provider.test.ts`    |   7.905 | server        |
| `test/cli/tui/plugin-lifecycle.test.ts`   |   7.330 | cli/tui       |
| `test/file/index.test.ts`                 |   7.214 | file          |

Targeted 3-run baselines:

| File                                      | Runs                   | Median | Notes                                                                        |
| ----------------------------------------- | ---------------------- | -----: | ---------------------------------------------------------------------------- |
| `test/control-plane/workspace.test.ts`    | 12.949, 12.949, 12.773 | 12.949 | Stable slow target.                                                          |
| `test/server/httpapi-listen.test.ts`      | 10.554, 10.631, 10.479 | 10.554 | Stable slow target; WebSocket/listener lifecycle.                            |
| `test/config/config.test.ts`              | 10.270, 9.042, 10.737  | 10.270 | Large serial file; initial 23s was mixed-scope contention/noise.             |
| `test/server/httpapi-sdk.test.ts`         | 7.600, 8.011, 8.035    |  8.011 | Stable slow target.                                                          |
| `test/plugin/install-concurrency.test.ts` | 7.949, 7.800, 7.712    |  7.800 | Stable slow target; many subprocesses.                                       |
| `test/provider/provider.test.ts`          | 8.323, 7.543, 7.474    |  7.543 | Large serial file.                                                           |
| `test/server/httpapi-cors.test.ts`        | 2.621, 1.682, 1.518    |  1.682 | Not a standalone top target; initial 14s was mixed-scope noise/order effect. |

## Dead Ends

None yet.
