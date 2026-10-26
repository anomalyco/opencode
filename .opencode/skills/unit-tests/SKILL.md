---
name: unit-tests
description: Use when writing, reviewing, speeding up, or fixing a flaky `bun test` unit test in any package (core, cli, server, ai, codemode, util, client, sdk, plugin, http-recorder, merman, app src and test-browser, desktop, gui-extensions, ui, session-ui, latex, ...), except OpenTUI renderer tests (see tui-tests). Also use when a test "timed out after 5000ms" on Windows CI, fails only on Windows, when the unit job is slow, when adding cli subprocess or service tests, or when adding a package's test task to turbo.json. Covers controlling time instead of sleeping, per-test timeouts, process and git spawn cost on Windows, Windows-only failures, temp dirs and process state, leaks between files, and reading CI timeouts.
---

# Fast, Reliable Unit Tests

CI runs `bun turbo test --affected --concurrency=3` on 4-vCPU Linux and Windows runners (unit job in `.github/workflows/check-test.yml`), so each suite shares the CPU with two others, and Windows is the slower leg. Most slow or flaky unit tests here wait on real time, spawn too many processes, or assert wall-clock speed.

Read these first; this skill does not repeat them:

- Root `AGENTS.md`: the Testing and Style Guide sections.
- `packages/app/AGENTS.md` Tests (`packages/desktop` and `packages/gui-extensions` follow it): one owner per contract, and no production seams for tests.
- `packages/ai/AGENTS.md`: cassettes. The `effect` skill: `it.effect` and `it.live`.

Sibling skills: `tui-tests` (OpenTUI renderer tests in tui and cli), `app-e2e-tests` (Playwright in `packages/app/e2e`), `component-tests` (Playwright on stories, `packages/stories`). This skill owns cli subprocess and service tests.

## Know the budget

- Bun's default per-test timeout is 5000ms. Check the package's `test` script:
  - 30s: ai, cli, desktop, http-recorder, latex, merman, simulation, theme and tui pass `--timeout 30000`; core's `script/test.ts` passes `--timeout=30000`.
  - 5s: client, httpapi-codegen and sdk pass `--timeout 5000`; app, codemode, function, gui-extensions, plugin, plugin-browser, script, server, session-ui, ui and util use the default.
- Size Windows risk by counting spawns, not by local wall time.
  - npm.test.ts "installs a Git package from an npm ::path: subdirectory at a branch" takes 0.4s locally and hit 5000ms on Windows CI. Each Npm.add Git case makes about 75 git process events: 3 `clone --recurse-submodules`, which run the git-submodule shell script.
  - Assume roughly 40ms per Git-for-Windows spawn (estimated from an earlier git.test run on Windows CI: ~24s for 564 spawns). Some core file groups run 5-9x slower on Windows than locally.
  - Those `test.each` cases (`npm.test.ts:223`, `:251`) hit 5000ms in 13 of 45 Windows core runs; that is why core's runner now defaults to 30s (comment at `packages/core/script/test.ts:38`).
- A timeout loosens the budget only when it exceeds the package default.
  - In a 5s package, work that legitimately needs longer gets a per-test timeout and a comment naming the work: `packages/server/test/fetch.test.ts:406-407` ("Real retries wait 18 \* 200 ms ...", `{ timeout: 10_000 }`). `test.each(table)(name, fn, 30_000)` takes it as the third argument. Use file-wide `setDefaultTimeout` only when every test in the file does such work.
  - In core, the four file-level `setDefaultTimeout(30_000)` calls only restate the runner default, and a per-test `{ timeout: 15_000 }` (still in `tool-shell.test.ts`, `session-generate.test.ts` and others) is stricter than it. Do not add values at or below 30s there.
- Never absorb a sleep, poll or production interval with a larger timeout, `--retry`, or `skipIf(win32)`; remove the wait. Skip on Windows only when the platform lacks the capability, with a comment (`npm.test.ts:313`, symlinks).

## Control time; do not wait for it

- **Effect code.** `it.effect` from `packages/core/test/lib/effect.ts` runs on `TestClock`; `testEffect(layer)` adds your layer. server and cli import it from `../../core/test/lib/effect`; ai has `packages/ai/test/lib/effect.ts`.
- **Fork, then adjust.** Fork with `Effect.forkChild({ startImmediately: true })` (`packages/ai/test/http-timeout.test.ts:58`), or await a Deferred the code completes and then `Effect.yieldNow` (`:80-81`). Otherwise `TestClock.adjust` can run before the sleep is registered, and the join hangs until Bun's timeout.
- **Debounced streams and watchers.** `advance(condition)` and `drain` in `packages/core/test/lib/clock.ts` alternate one real 1ms macrotask with 500ms adjusts, because debounces register sleeps across fiber hops. Use `drain` (4 such steps) before a "nothing happened" assertion instead of `Bun.sleep(25)`. `advance` is bounded by 15s of real time, not a step count, because its condition can also wait on slow real work (a plugin import, a child, a large write) that took more than 100 steps on a loaded Linux runner (`supervisor-reload.test.ts` "retains a discovered plugin change during initial activation").
- **Real I/O between virtual steps.** `TestClock.withLive(Effect.sleep("10 millis"))`. `registered()` at `packages/cli/test/service.test.ts:740` tests the 5s registration watch with real file I/O under `it.effect`. This departs from the effect skill's "filesystem → `it.live`" on purpose: the timer is the contract.
- **Real events need `it.live`.** Under `it.effect` the clock moves only when the test adjusts it, so an Effect timeout on a path driven by real processes, sockets or file events never fires and a missing event hangs instead of failing. The AppProcess tests (`packages/core/test/process/process.test.ts:13-14`) use `it.live` because the spawner's 1-second post-exit capture deadline (`packages/util/src/cross-spawn-spawner.ts:322`) never fired under TestClock.
- **Give a racing component its own clock.** When a real-time deadline races slow setup, provide that component a `Clock` that only the test moves past the deadline. `packages/core/test/browser-idle.test.ts:24-38` wraps the live clock for `LocationActivity` (`:49-51`) and adds the TTL at `:84`, once the browser state is attached. Before, it waited out a real 2s TTL and failed on Windows CI with "RPC is unavailable: experimental.browser" when plugin activation was slow. Shortening a real TTL makes that race flakier.
- **Product Effect code must stay on the caller's clock**, which is what makes both patterns above possible. Read time through `Clock`, wait with `Effect.sleep` or `Schedule`, and run nested effects with the caller's context.
  - A bare `Effect.runPromise` runs on the default real clock. McpStdio does this (`packages/core/src/mcp/stdio.ts:66`, `:82`, `:109`), so `packages/core/test/mcp.test.ts:832` waits the real 2s `CLOSE_GRACE` on every OS.
  - Capture `yield* Effect.context()` and use `Effect.runPromiseWith(context)`, as `packages/cli/src/acp/agent.ts:27` does.
- **Code outside Effect** (app, desktop, ui, session-ui): `jest.useFakeTimers()` and `setSystemTime` from `bun:test`, restored in `afterEach` (`packages/desktop/src/main/extension/lifecycle.test.ts:27-32`, `packages/desktop/src/main/storage/drafts.test.ts:15-17`).
- **Advance fake timers to the next timer** (`jest.advanceTimersToNextTimer()`, `jest.runOnlyPendingTimers()`), not in small fixed steps. The 10ms-step `advance` at `lifecycle.test.ts:37` turns the 1,000-seed fuzz test (`:607`) into about 430k event-loop turns: 2.8-3.8s on Windows, 0.56s on Linux.

## Real-time waits: deadlines, not attempt counts

- Bound a real-time poll in milliseconds, generously, and return as soon as it holds: `until` at `packages/cli/test/service-lifecycle.test.ts:267` (30s), `eventually` at `packages/core/test/integration.test.ts:37` (10s).
- Attempt-count loops hide a small budget that shrinks under load. Do not copy `waitUntil` at `packages/core/test/config/reload.test.ts:371` (100 × 10ms; the skills test at `:57` timed out after 1.2s on a Linux dev push) or `packages/core/test/plugin/provider-azure.test.ts:219` (3000 × 1ms).
- Poll for every state you assert afterwards: the reload poll at `reload.test.ts:301-317` includes the skills that `:319-320` assert.
- Let the test, not a timer, release a child's next step. The login command in `integration.test.ts:230-254` prints its secret only after the test, having seen the pending status, writes a release file; it used to print after a fixed `Bun.sleep(50)`.
- Small timer gaps race too: `packages/core/test/process/process.test.ts:59-67` ordered stdout and stderr with 10ms and 20ms child timers and failed on Windows CI (`out 2` read before `err 1`); it now uses 100ms and 200ms.

## When the wait happens in another process

TestClock cannot reach a spawned server or worker. These production waits already cost real time:

- cli (about 60s of its roughly 2-minute suite): the 15s bind-retry deadline (`Date.now() + 15_000` in `packages/cli/src/server-process.ts`), the 5s registration watch (`packages/cli/src/services/service-registration.ts:63`), and fixed sleeps (`Bun.sleep(8_000)` at `service.test.ts:620`, `Bun.sleep(5_500)` at `service-lifecycle.test.ts:237`).
- core (about 8s locally): McpStdio `CLOSE_GRACE` 2s + `FORCE_KILL_AFTER` 2s (`stdio.ts:10-13`), Shell `forceKillAfter` 3s (`packages/core/src/shell.ts:306`, `:401`), and the 1s capture deadline in cross-spawn-spawner.

To avoid adding more:

- Test the timing logic in-process under TestClock (the `registered()` tests at `service.test.ts:270-299`). Keep real processes for exit codes, signals, stdio and port binding, with one test per escalation path. Do not add tests that wait out these constants.
- Shorten a production duration through an option, not by waiting it out. Precedent: real product options (`Flock.Options` in `packages/util/src/flock.ts:41-47`, `idleTimeout`/`flushInterval` in `packages/client/src/solid/connection.ts`) and client's hidden seam `withEnsureTiming` (`packages/client/src/service-timing.ts:31`, used by `packages/client/test/fixture/service-timing.ts`).
  - For a spawned process the value must reach the child, as `timeoutMs` does through the worker payload at `packages/core/test/util/flock.test.ts:50-58`.
  - server-process.ts has no override today, so its 15s tests cannot be shortened from the test side.
  - app, desktop and gui-extensions forbid such seams (their AGENTS.md Tests sections); core, cli, util, client and tui have no such ban.
- Retry timing belongs in core under TestClock. `packages/server/test/fetch.test.ts:363-408` spends about 5.8s of server's 16s in real 200ms bind retries (`packages/core/src/plugin/provider/openai.ts:21`). The fixed ports 1455/1457 are the contract there; new server tests cover routing and error mapping only. Elsewhere bind port 0 (`packages/app/src/runtime/server/global-sync/bootstrap.test.ts:81`).

## Do not assert wall-clock speed

- `expect(performance.now() - startedAt).toBeLessThan(500)` failed on Windows at 510ms (`packages/ui/src/context/marked-parser.test.ts:84`); `packages/core/test/shell-scan/adversarial.test.ts:77` has the same shape. merman's layout audit no longer asserts its elapsed time.
- Count operations, or pick an input where a regression is catastrophic and assert only the result, so it trips the test timeout: `packages/codemode/test/openapi.test.ts:638` (depth 30 is 2^30 work without memoization). A ratio of two timings still fails on a load spike; if you keep one, use a generous factor and say it is timing-sensitive.

## Spawn less

- **Process start-up.** Each `bun run src/index.ts` CLI boot costs about 1.3s of CPU (the entry loads TUI `.tsx` through the preload in `packages/cli/bunfig.toml`). Test parsing and validation in-process; keep one or two real subprocess tests per file. Each cold bun child that imports the MCP SDK cost 1-3s; the MCP lifecycle tests, which spawned several, hit 5000ms on Windows until they moved to the in-process `resourceServer()` (`packages/core/test/mcp.test.ts:90`).
- **Spawned CLIs** use `isolatedEnv(root)` from `packages/cli/test/fixture/environment.ts`: isolated HOME, XDG and database, shared transpiler cache. `packages/cli/test/upgrade.test.ts:98` and `debug-paths.test.ts:24` set a private `XDG_CACHE_HOME` without `BUN_RUNTIME_TRANSPILER_CACHE_PATH`, so every spawn transpiles again; do not copy them.
- **Git.** Before the shared fixture below, a PATH shim counted about 2,850 git spawns per core run, and git.test took about 24s on Windows CI and 7s locally.
  - Create repos with `packages/core/test/fixture/git.ts`. `initGit(directory, ...initArgs)` (`:24-27`) runs one `git init` and appends the fsmonitor, gpgsign and identity settings to `.git/config` in one write; `initRepo` (`:64-67`) adds an empty root commit (2 spawns; with one `git config` per key it took 6), and `gitRemote` builds on `initGit`.
  - Do not write per-file `git init` plus `git config` copies. server still has two (`packages/server/test/vcs.test.ts:215-218`, `packages/server/test/worktree.test.ts:131-133`); server already imports core fixtures such as `tmpdir`.
  - Use `-c user.name=… -c user.email=…` only for commits the test makes itself (`npm.test.ts:53`). Repos where production code commits later (snapshot, worktree, vcs) need repo-local identity.
  - Keep identity repo-local. The unit job's "Configure git identity" step sets a global identity, but core's `script/test.ts` and cli's `isolatedEnv` replace HOME, so it is invisible there and visible to server and tui. That HOME isolation keeps core's missing-identity coverage: do not depend on CI's identity, and do not add a global gitconfig in core.
- **Independent children** start together (`Promise.all`, `packages/ai/test/exports.test.ts:63`). `packages/app/test-browser/playwright-config.test.ts` runs sequential `Bun.spawnSync` (3.5s on Windows, 1.4s on Linux); `packages/desktop/script/windows-installer.test.ts` makes 6 sequential cold `pwsh` starts for ACL reads, which one `pwsh` call could batch.
- **Size contention and thresholds to the claim.** `flock.test.ts:46` starts 16 bun workers; use only as many as still exceed the 4 CI vCPUs. A hard-coded threshold forces huge fixtures: `packages/core/test/git.test.ts:354` writes 2,100 files to cross `looseObjectLimit = 2048` (`packages/core/src/git.ts:50`), 2.7s locally and slower on Windows. Make the threshold an option with the production default, cross a small value in the test, and assert the default once.

## Windows-only failures

- Renaming onto a file another process holds open fails. cli `service.test.ts:462` failed on a dev push with `FileSystem.rename (...service-local.json.<uuid>.tmp)` from the temp-then-rename at `service-registration.ts:39`. Close handles the test holds; when two product processes race, fix the product, not the test.
- SIGTERM cannot be caught: `process.kill` ends the target at once with exit code 1, so a shutdown handler runs only on POSIX. Assert per platform with `catchesSigterm`, `stopSignal` and `stoppedExitCode` (`packages/client/test/fixture/service-fixture.ts:7-11`).
- Do not prove a stopped server released its port by binding it again. Windows hands out ephemeral ports from 49152 up, and any process, including suites running alongside, may take the port for an outgoing connection; a re-bind failed there with "Failed to start server. Is port 65518 in use?". Assert that nothing accepts connections (`expectNotListening`, `service-fixture.ts:108-117`).
- `os.tmpdir()` reads `TEMP` on Windows and `TMPDIR` on POSIX; set both for a child (`packages/util/test/global.test.ts:22-24`). Compare canonical paths with `fs.realpathSync.native`, which expands 8.3 short names such as `RUNNER~1` (`:84-86`).
- Reset a test socket once the request has arrived (`data`), not on `open`. Resetting on accept races the client's write, and on Windows the lost race is a write or connect error instead of a reset: `packages/util/src/retry.test.ts:25-30` recorded 2 of its 3 expected failures there. `packages/app/src/runtime/server/global-sync/bootstrap.test.ts:83-88` still resets on `open` and failed 3 of about 19 loaded local runs with `write EPIPE`, which `transientMessages` in `packages/util/src/retry.ts` does not list.

## Temp dirs, files, process state

- core's `script/test.ts` points HOME, XDG\_\* and TMPDIR (plus USERPROFILE, TMP and TEMP on Windows) at a fresh directory per run. Per-test dirs: `tmpdir()` (`await using`), `tmpdirScoped` or `withTempDir` from `packages/core/test/fixture/tmpdir.ts`.
- Close watchers, databases and children before the dir is removed. On Windows an open handle fails removal with `EBUSY`; `remove` in `tmpdir.ts` then forces a GC and retries every 100ms, up to 30 times.
- Restore process state: env with `withEnv` (`packages/core/test/fixture/env.ts`) in Effect tests and in `afterEach` elsewhere, real timers, and `setSystemTime()`.
- `CI=true` in the unit job, and Turbo passes it through. Code that reads `CI` takes another path there, so a test of the non-CI path unsets it itself: `packages/http-recorder/test/websocket.test.ts:132` wraps its record-mode case in `withEnvironment("CI", undefined, ...)`, because in CI that case replayed and waited forever for "open".

## Keep files independent without `--isolate`

- Except app, each suite runs all its files in one process with one module registry (core: 262 files), so state leaks between files.
- Do not use `mock.module`; it leaks across files.
  - It is why app's scripts pass `--isolate`: app unit went from 2.4s to 9.9s locally, and unit plus browser from 5.3s to 12-20s on CI.
  - `packages/cli/test/mini-config.test.ts:25` and `packages/core/test/plugin/provider-gitlab.test.ts:74` already leak in non-isolated suites; do not copy them.
  - In Effect packages, provide the dependency through a test layer. In app, desktop and gui-extensions, drive the real module and entry point, and inject only through a parameter the product already has.
- Never add `--isolate` or bare `--parallel` (which implies `--isolate`) to a test script: ai went from 7.6s to 26.3s with `--parallel=2`.
  - `--parallel=N --no-isolate` keeps the shared registry and measured 0.47-0.68x serial wall time at about the same CPU in core. It also exposed load-sensitive tests (browser-idle and integration's `eventually`, both since fixed).
  - Adopting it is a runner decision for maintainers once CI passes on both OSes, not a fix for one slow test.
- Runtime imports run in every file that loads the module. `packages/desktop/src/main/storage/store.ts:3` imports `electron` only for `getStore`, so `src/main/extension/storage.test.ts` and `src/main/storage/store.test.ts` download the ~100MB Electron binary on a fresh install. On a first local run, storage.test.ts took 5.3s of file time for 0.1s of test bodies. Use `import type` for types (`packages/desktop/src/main/ipc-transport.test.ts:4`).

## Turbo test tasks

- `bun turbo test` runs every workspace package that has a `test` script, through the generic `test` task in `turbo.json` (`"dependsOn": ["transit"], "outputs": []`). A package with test files but no `test` script never runs in CI: give a new suite a script, and check with `bun turbo test --dry=json`. Add an `@opencode/<pkg>#test` entry only to override the generic task (desktop disables caching). Suites CI skipped rotted: client, util, sdk, http-recorder and merman needed fixes before CI could run them.
- `transit` runs nothing and depends on `^transit`, so a test hash covers the package's whole workspace closure. The global dependencies add root `package.json` (whose `packageManager` pins Bun), `bunfig.toml`, `patches/**`, `.npmrc`, `.github/actions/setup-bun/**` and `check-test.yml`.
- Tests do not wait for builds: workspace packages export their sources (`"./*": "./src/*.ts"` in `packages/core/package.json`), so a test must not read a dependency's `dist`. The build job's "Build workspace libraries" step checks the library builds on Linux.
- A package that compiles `src` with tsc keeps colocated tests out of the build (`"exclude": ["src/**/*.test.ts"]` in `packages/util/tsconfig.build.json`). Otherwise `bun test` also runs the compiled copies, as Windows CI did with `packages/util/dist/retry.test.js`.

## When CI flakes

- Most suites print only failures (`--only-failures`): `(fail) <name> [5000ms]` and `^ this test timed out after 5000ms`.
  - When `killed 1 dangling process` and `# Unhandled error between tests` follow (for example `NpmInstallFailedError` with `SIGTERM` from a `git clone`), the test was still doing real work, not hanging.
  - The unhandled error is the abandoned Effect failing after Bun killed its child, not a second bug. Count the work (see Before you push) before choosing a fix.
- Check whether the test also fails on dev pushes: `gh run list --workflow check-test.yml --branch dev --event push --status failure`. In one census before core's 30s default, 4 of 25 dev pushes went red, all on Windows unit tests (3 of them Npm.add 5s timeouts).
- Read whole job logs with `gh run view --log --job <id>`; `--log-failed` omits green jobs, whose `Ran N tests across M files. [Xs]` lines you need for comparison.
- Assert a child's stderr before its exit codes. `packages/core/test/util/effect-flock.test.ts:327-328` checks codes first, so its one CI failure never showed the cause.

## Before you push

Run from the package directory with the flags from its `test` script (app needs `--conditions` and `--preload`). In core use `bun run script/test.ts <file> …`, which forwards flags, isolates HOME and applies the 30s timeout.

- [ ] `bun test <file> --rerun-each 10` passes every time. Add `--randomize` for order dependence; reproduce a failure with `--seed=<n>`.
- [ ] Per-test durations: `--reporter=junit --reporter-outfile=<abs path>` (works through `script/test.ts`). Any test over about 1s does real work you can name.
- [ ] Windows: count spawns. `GIT_TRACE=<abs file>` logs roughly one `trace: built-in:` or `trace: exec:` line per git process; a logging `git` shim first on PATH also works. At about 40ms per spawn, compare with the package timeout.
- [ ] Rerun the file while the full package suite runs in another terminal; CI runs three suites on four vCPUs.
- [ ] Grep the diff for `Bun.sleep(`, `setTimeout(`, `Date.now() +`, `performance.now()`, `Effect.runPromise(` in product code, `mock.module`, `git config`, and literal port numbers.
- [ ] After CI: with `--only-failures`, the `unit (windows)` log hides passing durations. Compare your package's `Ran N tests across M files. [Xs]` line with a recent dev run's.
- [ ] New package suite: `bun turbo test --dry=json` lists `@opencode/<pkg>#test`.
