---
name: tui-tests
description: Use when writing, fixing, or reviewing tests that render OpenTUI (testRender, createTestRenderer, createAppFixture) in packages/tui or packages/cli. Covers frame waits (waitForFrame, waitFor, waitForVisualIdle, flush), started vs non-started renderers, injected clocks, mock keyboard and mouse input, terminal sizes, cleanup and shared paths, and the 30s budget. Also use when a TUI test fails with "Timed out waiting for frame predicate after N passes", or when a tui test file is slow. For cli subprocess and service tests, use the unit-tests skill.
---

# TUI tests

packages/tui runs about 170 test files in one `bun test` process. CI runs it next to up to two other suites on 4-vCPU runners (`bun turbo test --affected --concurrency=3` in `.github/workflows/check-test.yml`), where it has taken 136-146s on Linux and 147-171s on Windows, most of it idle on frame pacing, production timers and sleeps. Most flakes come from waiting on the wrong signal and then running out of frames on a busy runner.

Read the root `AGENTS.md` Testing section (no `globalThis` mocks, run from the package directory) and its TUI Stories section. To drive the real TUI, use the `opencode-dev` skill. For CLI subprocesses, service deadlines, Effect `TestClock` and turbo test tasks, use the `unit-tests` skill.

## Frame budgets are not time

- `waitForFrame`, `waitFor` and `flush` give up after `maxPasses` (default 20). `waitForVisualIdle` gives up after `maxFrames` (default 20). One pass is one rendered frame (`DEFAULT_MAX_PASSES` in `@opentui/core/testing`). "Timed out waiting for frame predicate after 20 passes" comes from this budget, not from bun's timeout.
- **Started renderer** (`setup.renderer.start()`, as `createAppFixture` does at `packages/tui/test/fixture/app.ts:28`): frames tick at OpenTUI's default 30 fps, so 20 passes are about 0.66s. Production renders at `targetFps: 60` (`packages/tui/src/app.tsx:241`), so test frames are twice as slow as the real app.
- **Not started** (the default for `testRender` and `createTestRenderer`): `waitFor` and `waitForFrame` fail within milliseconds when no render is scheduled, and the error shows `isRunning: false`. In the same state `flush()` and `waitForVisualIdle()` return immediately without error; they do not wait for fetches or timers. Await the signal, then `renderOnce()`.
- Wait on frames only for something a frame produces. For anything else, wait on the signal itself:
  - **Focus set on a timer.** `DialogSelect` focuses its filter with `setTimeout(..., 1)` (`packages/tui/src/ui/dialog-select.tsx:702`), which takes about 15ms on Windows. `typeText` sends keys to whatever is focused, so early keys are dropped and Enter then picks the default option. Put the focus in the predicate, as both dialog waits in `packages/tui/test/command-selection.test.tsx` do (`:68-70` for the model, `:75-80` for the variant): `setup.renderer.currentFocusedRenderable instanceof InputRenderable`. Before the variant wait had it, the test flaked in 5 CI runs in 20 hours, including a dev push, and a bigger budget did not help: it still failed with `maxPasses: 150`, because the keys were lost, not late. If a wait fails with the focus in the predicate, look for a state race, not the budget.
  - **Markdown and code text.** `<markdown>` (`packages/tui/src/routes/session/message-parts.tsx:182`) draws no text until the shared tree-sitter worker replies, while frames keep ticking, so a plain `waitForFrame` can spend all 20 passes on a loaded runner with the text still pending. Use `waitForHighlightedFrame(setup, predicate, options?)` from `packages/tui/test/fixture/frame.ts`. When the predicate fails, it awaits every in-flight `CodeRenderable.highlightingDone` inside the frame predicate, and awaiting there does not use up passes. It accepts any setup with `renderer` and `waitForFrame`; app-lifecycle, session-group-navigation and session-home wait on transcript text this way. If the code under test accepts a client, inject `new MockTreeSitterClient({ autoResolveTimeout: 0 })` instead (`packages/tui/test/mini/scrollback.surface.test.ts:87`).
  - **Requests and other state.** Await the deferred response your fetch handler returns. With no signal to await, poll with a wall-clock deadline instead of raising `maxPasses`: the file-local `waitForFrame(setup, matches)` at `command-selection.test.tsx:117` checks `captureCharFrame()` every 10ms for up to 2s. `wait` in `packages/tui/test/cli/tui/data.test.tsx:37` and `waitForModel` in `packages/tui/test/fixture/local.tsx:109` do the same for state.
- `waitForVisualIdle` returns on the first frame with `cellsUpdated === 0` by default. A frame waiting on a highlight is also quiet, so wait for the text before you measure layout or assert on it: `session-home.test.tsx:227` waits for "History message 0001" with `waitForHighlightedFrame` after `waitForVisualIdle()` instead of reading the frame directly.
- Settle steps cost frames. Each `waitForVisualIdle({ quietFrames: 3 })` takes at least 3 frames, about 100ms at 30 fps. `session-group-navigation.test.tsx` has 14 of them. When you know what you are waiting for, wait for that frame instead.
- Do not use `maxPasses` as a clock. Several waits do, and each assumes 33ms frames:
  - `app-lifecycle.test.tsx:792`: 120 passes to cover the 1s reconnect delay after `setup.events.disconnect()` at `:784`;
  - `app-lifecycle.test.tsx:1721-1723`: 200 passes per retry-countdown second;
  - `component/dialog-shell-output.test.tsx:144`: 100 passes for a 1s poll, plus `Bun.sleep(1100)` at `:163` and `:182`;
  - `session-panel.test.tsx:590`: 120 passes in `ready()` for the initial load.

  With test frame rates scaled 4x, dialog-shell-output (3 tests) and session-activity-anchor (2 tests) failed. The same budgets are why tests cannot yet run at production fps. A larger budget is fine only for a long run of frame-driven work, such as scrolling 50 rows.

## Pick the renderer mode and clock

- **Component logic:** `testRender(() => <X />, { width, height })` without `start()`. Change state, `await app.renderOnce()`, then assert on `captureCharFrame()`. One frame, deterministic.
- **Time-driven renderables:** pass `clock: new ManualClock()`, call `renderer.pause()`, then advance the clock and `renderOnce()` (`fixture()` in `packages/tui/test/component/retry-provider.test.tsx:8`). `pause()` also stops `requestLive()` (spinners, animations) from starting the frame loop.
- **Clock order:** inject a clock first (OpenTUI `ManualClock`; Effect `TestClock` for Effect code, see `unit-tests`). Use `jest.useFakeTimers()` only when nothing is injectable: it patches the global timers of a process that runs every tui file, so restore them with `jest.useRealTimers()` in `finally` (`packages/tui/test/util/delayed-presence.test.ts:24-26`).
- **Whole app:** `createAppFixture` (`packages/tui/test/fixture/app.ts`) gives a started renderer, an in-process `Bun.serve` and `kittyKeyboard: true`. Call `await setup.ready` before the first wait. Passing `config` replaces the default `{ animations: false }`, so include `animations: false` yourself. The first use in a process pays `await import("../../src/app")`: about 1s idle, 12-25s under heavy load. Use it only when the behavior spans routes or data.
- **Server behavior:** use the existing `createFetch` and `createEventStream` fixture (`packages/tui/test/fixture/tui-client.ts:15`, `:69`) rather than spawning a server. The persistent PTY, for example, is faked as `/api/experimental/persistent-pty/...` routes plus a `Bun.serve` websocket (`packages/tui/test/session-wheel-focus.test.tsx:52`); real PTY behavior is tested in `packages/server/test/persistent-pty.test.ts`. Every fixture server listens on `port: 0` (`fixture/app.ts:32`) and is reached through `server.url`; never hard-code a port. Windows hands out ephemeral ports from 49152 up, so a fixed port in that range can already be taken by another connection.

## Keyboard and mouse

- Use `setup.mockInput`: `pressKey`, `typeText`, `pressEnter`, `pressEscape`, `pressArrow`, `pasteBracketedText`.
- Create renderers with `kittyKeyboard: true`. Without it, `mockInput` silently sends something else (OpenTUI 0.5.17):

  | Input                                        | Without kitty mode                        | With kitty mode |
  | -------------------------------------------- | ----------------------------------------- | --------------- |
  | `pressKey("u", { ctrl: true, shift: true })` | `ctrl+u`                                  | `ctrl+shift+u`  |
  | `pressKey("2", { ctrl: true })`              | `2`                                       | `ctrl+2`        |
  | `pressEnter({ shift: true })`                | `return`                                  | `shift+return`  |
  | `pressEscape()` then `pressKey("a")`         | `meta+a` (a lone Escape is held for 20ms) | `escape`, `a`   |

- A second click on the same renderable within 500ms (renderer clock) and within 1 cell becomes a word or line selection. Do not sleep past that window: `Bun.sleep(550)` at `packages/tui/test/session-activity-anchor.test.tsx:120` costs 4.4s per file. Call `setup.renderer.clearSelection()` first, which resets the click history, or click at least 2 cells away. In a `ManualClock` renderer driven by `renderOnce()`, `clock.advance(501)` also works.

## Terminal sizes

- Always pass `width` and `height`. Otherwise the renderer uses `process.stdout.columns`: your terminal locally, 80 in CI.
- Cover layout at a narrow and a wide width, for example `test.each([100, 44])` (`packages/tui/test/app-lifecycle.test.tsx:13`). After `setup.resize(w, h)`, `await setup.renderOnce()` or `flush()` before asserting. Run any real-time sequence at one width only.
- Measure work by counting, not timing: mounted rows (`packages/tui/test/session-mount-budget.test.tsx`), rendered diff lines (`packages/tui/test/cli/tui/diff-viewer.test.tsx:2198`). `performance.now()` thresholds fail on slow Windows runners.

## Timers, cleanup and shared state

- A TUI test that takes over a second is usually waiting on a production constant; make it injectable instead of waiting it out. Two such constants: the shell output poll `setTimeout(poll, more ? 0 : 1_000)` (`packages/tui/src/component/dialog-shell-output.tsx:73`; 6 tests, 18.8s, 95% idle) and `reconnectDelay = 1_000` (`packages/client/src/solid/connection.ts:33`; about 1s per reconnect test). connection.ts already takes `idleTimeout` and `flushInterval` options, so add a sibling.
- Clean up with `await using` or `finally`: destroy the renderer and stop the fixture server. Cancel timers first, or they throw "TextBuffer is destroyed" into the next test.
- Remove the tmpdir last. Destroy the renderer and await the app task first, as `createAppFixture`'s `[Symbol.asyncDispose]` does (`fixture/app.ts:63`). Removing it under a pending write logs "Failed to persist" and flock "lock is compromised".
- `TestTuiContexts` (`packages/tui/test/fixture/tui-environment.tsx:32-35`) defaults `home` and `state` to fixed `/tmp/opencode/...` paths. When the tree mounts a provider that writes under `paths.state` (`StorageProvider` in `src/context/storage.tsx:145`, `LocalProvider`, or the prompt history, frecency and stash providers), pass `paths={{ state, home }}` built from `tmpdir()` (`test/fixture/fixture.ts:8`). Process-shared paths are what keep tui from parallel workers: `--parallel=2 --no-isolate` halved local wall time (162.9s to 80.7s). Isolated mode re-imports `src/app` in each of the 18 test files that load it, at 6x the CPU.
- Bun does not cancel a timed-out test body. It keeps running and can fail the next test or rerun as "Unhandled error between tests". Triage the first failure in a file; the ones after it may be leftovers.
- Import another package's test helpers by relative path only from a package in tui's workspace dependency closure. `@opencode/tui#test` depends on `transit` in `turbo.json`, which folds tui's whole workspace dependency closure into the test hash, so `data.test.tsx:7` reaching `../../../../core/test` is covered because tui depends on `@opencode/core`. A package outside that closure is not hashed, and a change there can replay a stale pass (see `unit-tests`, Turbo test tasks).

## Timeouts and failures

- The tui and cli test scripts run `bun test --timeout 30000`; Bun's default is 5s. In tui, that budget exists for the cold `src/app` import, not for slow waits.
- A frame-budget failure is not a timeout problem. Raising the test timeout does nothing for it, and raising `maxPasses` only hides the wrong wait.
- A per-test timeout below 30s, like the 15000 at `session-group-navigation.test.tsx:249`, must still cover the cold import when the file runs alone. New per-test timeouts name their work in a comment (see `unit-tests`, Know the budget).
- A frame-budget failure that reproduces on every run of one branch is a regression in that change, not a flake. dialog-shell-output failed "after 100 passes" in 21 of 29 tui runs on one PR stack and in 0 of about 102 elsewhere. Do not answer it with a bigger budget.
- Do not add `skipIf(process.platform === "win32")` to hide a timing flake; fix the wait. Windows timers have about 15ms resolution, so a 1ms `setTimeout` race that never shows on macOS fails there.

## Before you push

- From `packages/tui`: `bun test --timeout 30000 test/<file>`. This matches CI's budget and prints per-test milliseconds, which the package script's `--only-failures` hides.
- `bun test --timeout 30000 test/<file> --rerun-each 10`: all 10 must pass. The first iteration pays the cold import, so a timeout on iteration 1 under heavy load is that import, not your wait. Repeat while one other suite runs (for example `bun run test` in `packages/core`), not on an overloaded machine. Before its focus wait, the command-selection race failed 5 of 8 local runs under load.
- Force the race you suspect: temporarily slow the timer or reply (for example the focus `setTimeout` to 150ms). The test must still pass. Revert afterwards.
- Negative control: make the predicate impossible. The test must fail fast with a frame dump, not hang until the timeout.
- Windows-sensitive behavior to check for: timers under 16ms, renaming a file another process holds, process kill, and paths shown in frames. On pushes and pull requests the unit job runs `--affected`, so `@opencode/tui:test` is scheduled only when tui, a workspace package it depends on, or a `globalDependencies` file in `turbo.json` changed. In the `unit (windows)` log, confirm the lines prefixed `@opencode/tui:test:` are there with `cache miss, executing` and a pass, and compare its `Ran N tests across M files. [Xs]` line with a recent run that included tui. Per-file timing is only available locally.
