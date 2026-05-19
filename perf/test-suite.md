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

| Hypothesis                                                                                                | Change                                                                                         | Before    | After   | Decision | Notes                                                                                                                          |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Repeated full-suite runs are too expensive for discovery                                                  | Switched full-suite benchmark to one run and added per-file profiler                           | ~250s/run | pending | keep     | Bun has no slowest-test reporter in this version; profile files directly.                                                      |
| Plugin install concurrency test spends time spawning more workers than needed to exercise lock contention | Reduced worker counts from 12/10/8 to 6/6/5; kept `holdMs: 30`                                 | 7.800s    | 6.204s  | keep     | Median from 3 targeted runs; still covers concurrent cross-process writes to server, server+tui, and existing json config.     |
| `httpapi-listen` PTY route tests pay for git repositories they do not assert on                           | Removed `git: true` from temp dirs while keeping config setup                                  | 10.554s   | 7.818s  | keep     | Median from 3 targeted runs; HTTP routes, tickets, websocket upgrade, restart, and no-auth paths still pass.                   |
| `workspace.waitForSync` timeout test waits the full production timeout                                    | Added optional timeout parameter defaulting to production timeout; timeout test uses 25ms      | 12.949s   | 8.305s  | keep     | Median from 3 targeted runs; production callers keep the 5000ms default.                                                       |
| `config.test` waits after dependencies even though `.gitignore` is written synchronously                  | Removed obsolete 1000ms sleep from writable `OPENCODE_CONFIG_DIR` test                         | 10.270s   | 9.433s  | keep     | Median from 5 targeted runs because one run was noisy; simpler test and no fixed sleep.                                        |
| SDK parity helpers create git repos for tests that only need files/config/session state                   | Changed `withProject` default to no git; explicit git init test still opts into no-git fixture | 8.011s    | 5.180s  | keep     | Median from 5 targeted runs because first run was cold/noisy.                                                                  |
| Provider plugin filter test waits on plugin dependency readiness setup                                    | Marked local plugin dependencies ready using the existing fixture helper                       | 7.543s    | 6.366s  | keep     | Median from 3 targeted runs; matches neighboring plugin provider test setup.                                                   |
| HTTP provider tests generate local plugins without dependency-ready fixture state                         | Marked generated `.opencode` plugin fixtures dependency-ready                                  | 7.905s    | 2.980s  | keep     | Median from 3 targeted runs; avoids unrelated plugin dependency setup in route tests.                                          |
| TUI plugin lifecycle timeout coverage waits the full production cleanup timeout                           | Added optional runtime dispose timeout override and used 25ms in the timeout test              | 7.330s    | 1.507s  | keep     | Median from 3 targeted runs; production default remains 5000ms.                                                                |
| Skill tool test initializes git even though it only reads local skill files                               | Removed `git: true` from the temporary directory fixture                                       | 2.320s    | 1.425s  | keep     | Single targeted rerun; still exercises skill discovery, permission request, and bundled file output.                           |
| Prompt shell semantics tests initialize git though they only assert shell/session behavior                | Removed `git: true` from shell-focused prompt fixtures while preserving config setup           | 26.930s   | 23.400s | keep     | Three targeted reruns passed after the change: 23.80s, 23.55s, 23.40s.                                                         |
| Remaining prompt behavior tests mostly do not require repository state                                    | Removed git setup from safe loop/reference/error fixtures; restored shell queue/cancel cases   | 23.400s   | 19.610s | keep     | Safety review found shell runner readiness depends on git-backed setup in several tests; current single rerun passes.          |
| Session processor effect tests do not require repository state                                            | Removed git setup from all processor-effect temp server fixtures                               | 12.500s   | 9.230s  | keep     | Two targeted reruns passed after the change: 9.61s, 9.23s.                                                                     |
| HTTP listen PTY ticket tests restart the same listener topology twice                                     | Folded directory-scoped ticket regression into the broader unsafe-ticket test                  | 7.051s    | 6.170s  | keep     | Two targeted reruns passed after the change: 6.76s, 6.17s; still covers mint failure and successful same-directory upgrade.    |
| File watcher readiness can write before async native subscriptions are active                             | Retried short readiness writes and accepted symlink-realpath HEAD events                       | failed    | 4.62s   | keep     | Three sequential focused watcher runs passed: 4.62s, 4.57s, 4.64s; full suite no longer failed in `watcher.test.ts`.           |
| First provider config/env/filtering block can use Effect-aware instance fixtures                          | Migrated six `tmpdir` + `withTestInstance` cases to `it.instance`                              | 6.06s     | 6.07s   | keep     | Neutral timing, but removes manual config file writes and instance plumbing; use as the pattern for later provider slices.     |
| Custom provider/model config cases can use Effect-aware instance fixtures                                 | Migrated three more config-heavy provider cases to `it.instance`                               | 6.07s     | 6.12s   | keep     | Neutral timing within noise, but continues removing manual config file writes on top of the first provider fixture PR.         |
| Provider env precedence and model lookup cases can use Effect-aware instance fixtures                     | Migrated four more provider lookup/default-model cases to `it.instance`                        | 6.12s     | 6.36s   | keep     | Noisy 5-run median; kept as a small stacked cleanup slice but do not claim speedup from this migration.                        |
| Simple config load cases can use Effect-aware instance fixtures                                           | Migrated JSON, shell, formatter, and lsp config load cases to `it.instance`                    | 14.18s    | 3.93s   | keep     | Three-run medians before/after; removes manual `tmpdir` + `withTestInstance` setup from the first simple config block.         |
| Config template, file include, and simple agent cases can use Effect-aware instance fixtures              | Migrated JSONC, env/file substitution, invalid config, and agent config cases to `it.instance` | 1.87s     | 1.90s   | keep     | Stacked on the first config slice; neutral timing but removes more manual `tmpdir` + instance plumbing.                        |
| Agent option, command, and legacy migration config cases can use Effect-aware instance fixtures           | Migrated agent variant, command, autoshare, and mode migration cases to `it.instance`          | 1.90s     | 1.83s   | keep     | Stacked on the config template slice; small neutral-to-positive timing and less manual setup.                                  |
| Local config update and directory cases can use Effect-aware instance fixtures                            | Migrated local `update` and `directories` cases to `it.instance`                               | 1.77s     | 1.71s   | keep     | Three-run medians; small positive/neutral timing, removes manual instance plumbing, and eliminates one existing unsafe cast.   |
| `.opencode` agent and command file-loading cases can use Effect-aware instance fixtures                   | Migrated singular/plural agent and command markdown fixture cases to `it.instance`             | 7.21s     | 1.87s   | keep     | Parent baseline was noisy (7.42, 7.21, 2.83); after runs were stable at 1.87, 1.98, 1.83. Keep as cleanup with no broad claim. |

## Profiling Results

Command shape:

```sh
TEST_PROFILE_GLOB='test/<area>/**/*.test.ts' TEST_PROFILE_TOP=15 bun run profile:test
```

Initial slowest files observed during discovery:

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

This table is historical profiling input, not the current ranking after kept changes.

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

Full-suite sanity checks:

| Command              |   Result | Notes                                                                                                                                           |
| -------------------- | -------: | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run bench:test` | 225.069s | Before continuing prompt/session work.                                                                                                          |
| `bun run bench:test` | 186.729s | After prompt, processor, and PTY wins before safety review restores.                                                                            |
| `bun run bench:test` | 202.317s | After restoring prompt shell coverage and SDK VCS parity coverage.                                                                              |
| `bun run bench:test` |   failed | Watcher blocker cleared; current run later failed in focused-passing `tool/skill.test.ts` and prompt shell timeout cases under full-suite load. |

## Dead Ends

| Hypothesis                                                             | Change Tried                                                                             | Before |  After | Decision | Notes                                                                                         |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -----: | -----: | -------- | --------------------------------------------------------------------------------------------- |
| `file/index.test.ts` pays unnecessary per-test global instance cleanup | Removed `afterEach(disposeAllInstances)` while keeping the explicit disposal test import | 5.262s | 5.089s | discard  | Improvement was within noise and the cleanup is a safety guard for many instance-state tests. |
| Socket reset retry test can shorten its idle-timeout path              | Reduced Bun server idle timeout and tried forced server close                            | 16.46s | failed | discard  | Shorter idle timeout changed the error shape; forced close hung. Keep the real socket reset.  |
| `tool/webfetch` can avoid per-test instance setup                      | Switched local HTTP tests from `it.instance` to `it.live`                                | 1.219s | failed | discard  | Tool execution reads instance-local agent state, so the temp instance is required.            |
| LSP client interop tests can shorten coarse request-handling sleeps    | Reduced fixed post-notification waits from 100ms to 10ms                                 | 4.270s | 4.740s | discard  | First run improved to 3.870s but verification was slower than baseline; not a clear win.      |
