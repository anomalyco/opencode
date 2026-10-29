---
name: app-e2e-tests
description: Use when writing, changing, reviewing, or debugging Playwright e2e tests in packages/app/e2e (regression keepers and user stories). Covers the mocked opencode server harness and the Bun static server, per-test isolation, page-load and route cost, the suite-wide service-worker block, races with first mount, hover, measurement, clock, dialogs and shortcuts, projects, shards and worker scheduling, rehearsing Windows timing locally, and diagnosing a CI flake from its artifacts. Not for component tests (stories mounted on packages/stories) or e2e/performance benchmarks.
---

# App e2e tests

Read `packages/app/e2e/AGENTS.md` and the Tests section of `packages/app/AGENTS.md` first. They define what to test, which locators to use, and how to assert. `packages/app/README.md` (E2E Testing) documents run modes and env vars. This skill covers what makes these tests slow or flaky in CI, which runs the suite as two shards per OS on 4-vCPU runners (`.github/workflows/check-test.yml:217-240`). Most races below were found on Windows.

All paths below are relative to `packages/app` unless they start with `packages/`, `services/` or `.github/`.

## What a test runs against

- **No opencode backend.** Each shard leg runs `bun --cwd packages/app test:e2e:built --shard=<n>/2` (`check-test.yml:287-292`). It builds once and starts one Bun static server, `e2e/utils/serve.ts`, on `127.0.0.1:${PLAYWRIGHT_PORT ?? 3000}`. All 5 workers share it (`playwright.config.ts:23-27`).
  - `serve.ts` keeps vite preview's SPA fallback rules. Do not move built e2e back to vite preview. On case-insensitive file systems it synchronously reads the whole `dist/_assets` directory (about 3,100 files) for every asset request, so every worker's page loads wait in line. The `e2e/performance` configs still use it to keep their baselines comparable.
- **The API is an in-memory mock per page,** running in the test worker. `mockOpenCodeServer` (`e2e/utils/mock-server.ts:202`):
  - answers `page.route("**/api/**")` with an Effect HttpApi handler;
  - fakes `/api/event` SSE with an init-script `fetch` override;
  - serves PTY sockets through `routeWebSocket`.
- **Unmocked routes fail the test** with a 501 and `Unmocked API request` (`mock-server.ts:403-411`). Add the route to `mock-server.ts` once instead of routing around it in a spec.
- **Build pages with the helpers:**
  - `mockWorkspace`, `openSession`, `openDraft`, `openWorktreeDraft`, `mockRemoteServer`, `openSettings` (`e2e/utils/workspace.ts`);
  - `setupTimeline` (`e2e/utils/timeline.ts:209`) for streamed timelines, `mockServers` (`mock-server.ts:495`) for several origins;
  - `seed` (`e2e/utils/app.ts:61`) for storage, `holdRoute` (`app.ts:207`) to hold requests until you release them.
- **Deliver events** with the mock's `push`, which buffers until the app connects, or with `installSseTransport` (`e2e/utils/sse-transport.ts:60`), whose `send` resolves on delivery. After `page.reload()`, await `transport.waitForConnection()` before sending (`e2e/regression/timeline-stream.spec.ts:1700-1702`).
- **Windows-only failures are races, not Windows code paths.** Mock directories are `C:/OpenCode/<name>` on every OS (`workspace.ts:33`), and nothing touches the disk. Lazy chunks, stylesheets and responses finish out of order more often on the Windows runners.

## Isolation

- **No shared state between tests.** Each test gets a fresh context, mock handler and init scripts. Outside `e2e/service-worker`, which runs under its own config and shares builds through a worker fixture (`e2e/service-worker/cache.spec.ts:21`, `:74`), app e2e has no `beforeAll`, serial mode, `test.extend` or worker fixtures. Keep it that way so `-g` and `PLAYWRIGHT_FULLY_PARALLEL=1` keep working.
- **Handlers mutate the objects you pass.** Creating a session pushes into `sessions` (`mock-server.ts:839`). Renaming writes `session.title` (`:1340`), and VCS init writes `project.vcs` (`:1019`).
  - Call `session()`/`project()` inside the test.
  - `mockWorkspace` and `openSession` copy what you pass (`workspace.ts:36-48`).
  - `mockOpenCodeServer` and `mockServers` use your objects as they are. Module-level fixtures like `multi-server.spec.ts:10-19` are therefore shared by every test in the file.
- **Timeline builders keep state per test attempt** (`timeline.ts:165-198`). Call stateful builders such as `assistantMessage` or `partUpdated` inside the test. Only pure ones such as `toolPart` belong at module scope.
- **Seed before the first `goto`.** `seed` writes storage once per tab behind a `sessionStorage` marker, so reloads keep what the app stored (`app.ts:59-90`). It cannot reset state mid-test.

## Keep it fast

- **Navigate once.** Every `goto` or `reload` is a cold load of the production bundle: about 150 requests per session open, about 125 of them static files. Each test has a new context, and any `page.route` disables the HTTP cache. Reach later states through the UI or through pushed events. Reload only when surviving a reload is the contract.
- **Service workers are already blocked suite-wide** (`serviceWorkers: "block"`, `playwright.config.ts:66-67`). Do not add a per-file block; the 11 in `e2e/regression` are redundant.
  - Production registers `/sw.js` on load (`src/entry.tsx:54-55`) and precaches about 1,600 files (`globPatterns: ["**/*"]`, `vite.pwa.ts:34`). `e2e/service-worker/` covers it under its own config. The main config ignores that directory (`playwright.config.ts:33-36`), and CI runs it after shard 2 (`check-test.yml:294-298`).
  - Opt back in with `test.use({ serviceWorkers: "allow" })` only when the worker is the contract. It never controls the first load (`clientsClaim: false`, `vite.pwa.ts:26-28`). After a reload it can control the page, and page routes may then miss its requests.
  - Every built-mode page load logs Playwright's block warning. Console collectors must ignore it, as `captureConsoleWarnings` does (`e2e/utils/command-palette.ts:15-26`).
- **Match new routes with a RegExp or a query-aware glob, not a function.**
  - A single function matcher makes Playwright intercept `**/*` for the page. Every static asset then round-trips to the test worker (250 continued requests in one Windows test).
  - Existing `holdRoute` calls such as `review.spec.ts:51` and `mockMissingLocation` (`mock-server.ts:480`) still use functions and pay this. Converting one route gains nothing while another function route is registered on the page.
  - Globs match the whole URL, so `**/api/vcs/init` misses `/api/vcs/init?location...`. Write `/\/api\/vcs\/init\?/` or `"**/api/session?*"` (`command-palette.spec.ts:10`, `:28`).
- **Use the stress fixture only when scale is the contract.** `fixture`, `mockStressTimeline` and `installStressSessionTabs` (`e2e/utils/session-fixture.ts:336`, `:436`, `:448`) serve a long timeline with 300-line diffs.
  - Its cold mount reveals rows only after worker-rendered markdown arrives. Mounting one of its diffs blocked the renderer for 4-11 s on CI.
  - The 14 regression files that use it held about half of the e2e flakes CI found.
  - Prefer `openSession` or `setupTimeline` with the few messages the test needs.
- **Assert inside loops only when each step is the contract.** A web-first assertion that fails its first check retries after 100, 250, 500, then 1,000 ms. The 10-step loop at `mobile-timeline-scroll.spec.ts:688-693` takes about 8 s, mostly backoff.
- **Real-time waits cost their full length on every run and retry** (`settings-wsl.spec.ts:268-276` waits out a 10 s health check). Prefer `page.clock`:
  - install it before the `goto` or `reload` whose timers you need (`timeline-stream.spec.ts:1700`);
  - keep fast-forwards under the client's 45 s event-stream idle timeout (`packages/client/src/solid/connection.ts:35`).
- **Leave benchmark pacing out of regression tests.** The `sendAll` delays and `messageDelay` exist for benchmarks (`timeline.ts:306`, `mock-server.ts:82`). Hold message pages with `beforeMessagesResponse` instead.

## Wait for state, not time: races CI found

Most of these rarely reproduce on an idle local machine.

- **First mount happens in stages.** `openSession` and `expectSessionTitle` return once the composer is editable and a title is visible. Later the loading header's `<h1>` is replaced, and a cold timeline keeps its rows hidden while it scrolls itself to the bottom. Before you measure or hover in the session view, wait for something that only the final mount renders, such as the last `[data-timeline-row="UserMessage"]` or the row you click next.
- **Hovering during a scroll loses the tooltip.** A tooltip closes when its trigger scrolls, and Playwright's mouse never moves again. `session-summary.spec.ts:21-26` waits for the last row before it hovers; without that wait it needed a retry in 6 of 36 Windows runs.
- **One-shot measurements can hit a detached node.** `locator.evaluate` resolves the element, then evaluates in a second round trip. If the node is replaced in between, `getBoundingClientRect` returns an all-zero rect and `boundingBox` returns `null`. The subagent title-anchor test failed with "Expected: 0" in 11 runs until it waited for a timeline-only button (`subagent-child-navigation.spec.ts:60-64`). Take reference measurements once the final structure is in place. Polled reads re-resolve and are safe.
- **`goto` returns late, so a modal may already be open.**
  - `goto` waits for `load`, which can fire after the app is already interactive.
  - An open dialog sets `aria-hidden` on the app root, which hides everything behind it from role locators.
  - What's New opens 500 ms after the changelog response, and it raced the Settings check in 11 of 36 Windows runs. Hold the request that opens a modal until readiness is asserted, as `startUpgraded` does (`whats-new.spec.ts:227-234`).
- **`pauseAt(new Date())` right after `install()` can throw** "Cannot fast-forward to the past", because the installed clock starts slightly ahead of the runner's clock. Install at an explicit time and pause at an offset from it (`tabs.spec.ts:443-445`).
- **A shortcut that does nothing is usually a product guard, not timing.** The global handler ignores keys while `dialog.active` (`src/shell/commands/command.tsx:489`). `active` is the top dialog that has not started closing (`packages/ui/src/context/dialog.tsx:52`, `:310-311`). A dialog that has started closing does not block keys during its 100 ms exit (`dialog.tsx:87`), but any open dialog does, including one you did not expect. Check that guard before you add a wait.
- **Shortcut tests fail on local macOS; that is not a regression.**
  - The Desktop Chrome profile reports a Windows UA and `navigator.platform = "Win32"`, so the app (`IS_MAC`, `command.tsx:14`) expects Ctrl. On macOS, `ControlOrMeta` sends Meta.
  - Every test that opens the palette through `openCommandPalette` (`e2e/utils/command-palette.ts:50`) fails locally and passes in CI, as do `tabs.spec.ts:835` and `timeline-cache.spec.ts:163`. Verify on Linux or in CI, or press `Control` in a throwaway copy. Do not edit tests for macOS.
  - A new test can pick the modifier from the page, as `session-summary.spec.ts:29-30` does.
- **Font probes mislead.** `document.fonts.check()` can stay false after the font has loaded: when a lazy `@layer` stylesheet activates late, Chromium rebuilds font faces as unloaded. The code-font test failed outright in 9 of 36 Windows runs that way. Polling a probe that lays out text can make itself true. Await `document.fonts.ready`, lay out new text, and then check once (`timeline-cache.spec.ts:281-293`).
- **Use the harness's signals.** `holdRoute(...).arrived` resolves when the request reaches the route, and `transport.send` resolves after delivery. `setupTimeline(...).waitForPart` resolves once a part renders (`timeline.ts:328`).
- **Decide which side is wrong.** Three of eight investigated e2e flakes were product bugs, each since fixed in the product:
  - a stale scroll offset restored when a scroll settles (`src/session/timeline/observe-element-offset.ts`);
  - a video double-click that also entered native fullscreen (`packages/gui-plugins/src/file/artifact-view.tsx:612`);
  - shortcuts dropped while a dialog closed.

  If a user could hit the interleaving, fix the product and keep the assertion.

## Scheduling

- **Two projects split the suite** (`playwright.config.ts:69-86`). `chromium-touch-scroll` runs only `mobile-timeline-scroll.spec.ts`, which the `touchScroll` regex (`:29`) matches, with `fullyParallel: true`.
  - Projects queue in declaration order, so its 37 tests start after every `chromium` file and spread across all workers. As one serial group, the file took 3-5 minutes in CI.
  - A rename that the regex misses quietly puts the file back in `chromium` as that serial group.
  - `--project chromium`, UI mode and the VS Code extension's default project skip the file.
- **In `chromium`, files are the scheduling unit.** `fullyParallel` is off unless `PLAYWRIGHT_FULLY_PARALLEL=1` (`:42`), so a file's tests run in order on one worker. A long file sets a floor and leaves an idle tail. New regressions go into the area's keeper file (`e2e/AGENTS.md`), so keep each case cheap.
- **Shards split whole files by test count, not duration** (`check-test.yml:229-232`). The touch project queues last, so its tests always fall in shard 2. To reproduce a leg's schedule, pass the same `--shard`.
- **Worker-scoped options fork a worker.** `launchOptions`, `channel`, `headless`, `video`, `trace`, `screenshot` and `defaultBrowserType` give a file its own worker hash.
  - Playwright groups a project's files by worker hash in order of first appearance, so such a file runs after every default file in its project.
  - Use test-scoped options instead: `viewport`, `deviceScaleFactor`, `hasTouch`, `isMobile`, `userAgent`, `colorScheme`, `serviceWorkers`, `locale`.
  - Use `launchOptions` only when a Chromium flag is the contract, with a comment (`patch-border.spec.ts:5-9`).
- **Never spread `devices[...]` into `test.use`.** iPhone entries set `defaultBrowserType: "webkit"`, which forks a worker and needs a browser that CI never installs (`check-test.yml:282-285`). Copy the fields you need, as `mobile-timeline-scroll.spec.ts:23-28` does.
- **Retries are not free.** CI retries twice (`playwright.config.ts:44`). Each failure restarts the worker's browser and costs 10-30 s of cleanup on Windows. The first retry then reruns with a trace and a video (`:62-65`).
- **Timeouts are not a fix.** The limits are 60 s per test and 10 s per assertion (`playwright.config.ts:38-41`). `APP_READY_TIMEOUT` (30 s, `e2e/utils/waits.ts:4`) covers only first readiness.
  - When one wait is genuinely long, scope the timeout to that assertion and say what takes the time. `settings-wsl.spec.ts:268-276` does this with `{ timeout: 20_000 }` for a 10 s health check.
  - `test.setTimeout` does not lengthen assertions. `timeline-history.spec.ts:73` sets 240 s without a comment and still fails at the 10 s poll at `:127`.

## Before you push

Run from `packages/app`:

- [ ] Run in built mode, as CI does: `bun run test:e2e:built -- e2e/regression/<file>.spec.ts`. Dev mode serves unbundled modules, with the API on another origin (`playwright.config.ts:19-21`).
- [ ] Use a free port when another worktree or agent may hold 3000: `PLAYWRIGHT_PORT=4310 bun run test:e2e:built -- ...`. Built runs never reuse a server, and `serve.ts` fails on a busy port. Stay below 49152 on Windows: it reserves ports from there up and hands them out for outgoing connections (`services/www/src/docs/content/cli/web.mdx:43`, `packages/client/test/fixture/service-fixture.ts:108-109`).
- [ ] To repeat without rebuilding:
  - build once with `VITE_OPENCODE_TEST_FIXTURES=1 bun run build`;
  - keep `bun e2e/utils/serve.ts --host 127.0.0.1 --port 4310` running;
  - run `PLAYWRIGHT_BUILD=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4310 bun run test:e2e -- ...`.
- [ ] Repeat new or changed tests at CI concurrency without retries: `--repeat-each=10 --workers=5 --retries=0 -g "<title>"`. Run the file once with `PLAYWRIGHT_FULLY_PARALLEL=1` to prove that order does not matter.
- [ ] Rehearse Windows timing by delaying assets, not only the CPU. CPU throttling at 4x and 6x did not reproduce the tooltip or title-anchor races, but delayed responses did.
  - In a throwaway copy, hold the suspect lazy chunk, stylesheet or API response with `holdRoute`, and release it 0.6-1.5 s after `arrived`.
  - Route worker scripts with `page.context().route`.
  - A race fix must fail before the fix and pass after it (`packages/app/AGENTS.md`, Tests).
- [ ] Check the cost on a noisy machine. Other agents add load, and local A/Bs at a load average of 20-35 were inconclusive.
  - Compare the medians of interleaved before/after runs at `--workers=5`, or the step durations in the report (`bun run test:e2e:report`).
  - Count every `goto` and `reload` you added.
- [ ] `bun run typecheck:e2e` reports 4 existing errors: `timeline-stream.spec.ts:1822`, `:1825`, and two `e2e/performance` probes. Add none. If you changed `playwright.config.ts`, update `test-browser/playwright-config.test.ts`.

## When CI flakes

- **Find it.** e2e runs on pull requests that affect `@opencode/app` or `@opencode/stories`, including their workspace dependencies, and on every manual dispatch (`.github/workflows/check-test.yml:50-62`). It never runs on dev (`:28`).
  - Each OS has the legs `app-1` and `app-2` (the shards), `session-ui-components` and `app-components`.
  - The required `e2e (linux)` and `e2e (windows)` checks only aggregate those legs (`:329-352`).
  - A pass on retry leaves a leg green. Check each Windows shard report's Flaky list, and make sure your new tests are not on it.
- **Download:** `gh run download <run-id> -n playwright-windows-app-2-1 -D <dir>`. Artifacts are named `playwright-<os>-<leg>-<run attempt>` (`check-test.yml:314-327`). App e2e results are in `<dir>/app/e2e/`.
- **In CI, the failing first attempt has no trace and no video** (`playwright.config.ts:62-65`).
  - `test-results/<test>-<project>/` holds `error-context.md` (the aria snapshot at the failure) and `test-failed-1.png`.
  - `<test>-<project>-retry1/` holds `trace.zip` and `video.webm` whether the retry passed or failed, plus failure files only if it failed. A second retry records neither.
- **Read `error-context.md` first.** An open dialog or an element with no accessible name explains most "element(s) not found" errors.
- **Get timings from the retry trace:** `bunx playwright show-trace <dir>/app/e2e/test-results/<test>-<project>-retry1/trace.zip`. To see which side won, compare when a screencast frame changed with when the response landed.
- **Get the transient state from a failing video,** sampled frame by frame (`ffmpeg -i video.webm -vf fps=4 frame-%03d.png`). That is how the tooltip race showed the tooltip closing in the same frame the timeline rows appeared.
  - In CI, retry1's video shows the failure only if the retry failed too.
  - Locally, a failing test keeps its video (`retain-on-failure`), so you can record the race with `--repeat-each` and delayed assets.
- **Open the report:** `bunx playwright show-report <dir>/app/e2e/playwright-report`. It shows step durations for every attempt, including passing ones.
