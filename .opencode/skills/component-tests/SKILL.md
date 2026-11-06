---
name: component-tests
description: Use when writing, changing, debugging, or reviewing the Playwright component tests that mount stories. That covers specs in packages/app/component-tests or packages/session-ui/component-tests, `*.fixture.tsx` files there or beside source (such as packages/gui-plugins/src/browser/panel.fixture.tsx), the stories they mount, and the shared harness in packages/stories (playwright/config.ts, playwright/story.ts, vite.config.ts, src/frame.tsx, src/index-plugin.ts, mocks). Also use when a component test is flaky, passed on retry, or fails with "Execution context was destroyed", "Failed to fetch dynamically imported module", or `#story-root` hidden. Covers mount args, source modules imported by URL, Vite dependency pre-bundling and reloads, a cold vs warm story server, mobile drawers, geometry, and checks before pushing.
---

# Component tests

Each package suite starts one story server, a plain Vite dev server for `packages/stories`, and every worker shares it (`packages/stories/playwright/config.ts:17-26`; CI uses 2 workers, `config.ts:15`). With `fullyParallel` (`config.ts:12`), the tests of one file run on several workers in any order. There is no backend: server, SDK and sync modules are in-page mocks. Every test gets a fresh context, and `mount` is a full page navigation to the frame (`packages/stories/playwright/story.ts:37`). Slow or flaky component tests in CI have come from five sources: the shared server's dependency optimizer, module resolution that depended on the install layout, a cold first story, a product race (the mobile drawer), or an action that ran before the UI reached the state it needed.

Read these first rather than repeating them:

- `packages/stories/playwright/README.md` covers layout, run commands and "Adding a test".
- `packages/app/AGENTS.md` "Tests" decides whether a test should exist, when theme or direction cases are allowed, and that a regression test must fail before the fix.
- `packages/app/e2e/AGENTS.md` "Test Hygiene" applies here unchanged.

## Stories and `mount`

- **Location.** Put the story next to the production component under `src/` of `ui`, `session-ui`, `app` or `gui-plugins`. The story server indexes `*.stories.tsx` files in those four trees (`packages/stories/vite.config.ts`, `src/index-plugin.ts`), reading each file's `export default { title, id }` and its `export const` stories from source.
- **Story ID.** It is the meta `id` if one is set (`packages/session-ui/src/components/session-review.stories.tsx:25`). Otherwise it is the kebab-cased `title`, then `--`, then the kebab-cased export. Check it at `http://127.0.0.1:6006/?id=<id>` on a running story server (`bun --cwd packages/stories dev`). A wrong ID renders nothing (the page throws `No story has the id …`), so `mount` waits out its full 30 s root wait (`story.ts:39`) and then fails.
- **URL args.** `mount(id, { args, globals })` writes them into the URL as `key:value` pairs (`story.ts:20-36`). The frame reads every one: a value becomes a boolean or number when the story's own default for that key is one, `!true`/`!false`/`!null`/`!undefined` keep Storybook's meaning, and anything else stays text.
  - Give every arg a typed default. With `args: { split: false }` (`session-review.stories.tsx:129`), `split:false` arrives as a boolean.
  - A value containing `;` would split the pair list, so pick such values inside the story, from a `scenario`-style arg.
- **Globals** are `theme` (default `light`), `direction` and `locale` (`packages/stories/src/frame.tsx`).
- **Portaled UI.** `mount` returns `#story-root`. Dialogs, menus and drawers render outside it, so locate them from `page` (`packages/app/component-tests/composer.spec.ts:101-107`).
- **Server state** comes from the `resolve.alias` list in `packages/stories/vite.config.ts`, which points app server, SDK and sync modules at `packages/stories/mocks/app/**`. Extend a mock rather than adding a server. The app's components lab renders the same stories inside the real app instead, so a story must not depend on a mock-only export. Tests reset mock state on every mount.
- **Requests the mocks do not answer.** Route them with `page.route`. That includes server endpoints such as `/api/fs/read` (`packages/session-ui/component-tests/read-image.spec.ts:20`) and external URLs such as favicons (`packages/session-ui/component-tests/markdown.spec.ts:217`).

## Fixtures imported by URL

Use these when the contract is not visible in a story, such as construction counts, unmount races or cache state.

- **Fixture file.** Put a `*.fixture.tsx` file in `component-tests/` or beside the source it drives (`packages/gui-plugins/src/browser/panel.fixture.tsx`). It exports a `mountX()` that renders into a host with a `data-testid` (`packages/session-ui/component-tests/basic-tool.fixture.tsx:7-46`). Never end the name in `.spec` or `.test`.
- **Mount it in three steps.**
  1. Mount a light story first, so that the app styles load.
  2. Import the fixture and call it inside `page.evaluate`.
  3. Locate it with `page.getByTestId` (`packages/session-ui/component-tests/basic-tool.spec.ts:30-36`).

  It renders outside the frame's decorators, so it must supply its own providers (`packages/app/component-tests/browser-pane-restore.spec.ts:69-83`).

- **Module URLs.** Build each one with `sourceURL(new URL("<relative path with extension>", import.meta.url))` (`story.ts:10`), written as a string literal in the spec (`browser-pane-restore.spec.ts:6-24`). Any other spelling either fails to load or loads a second module instance whose contexts the page never provides; a hand-written `/@fs//...` is the documented second-instance case (`story.ts:6-9`). The literal also matters for pre-bundling (next section).
- **Aliases.** A module imported by URL is the real file. App code that reaches the same module through a `vite.config.ts` alias gets the mock (`browser-pane-restore.spec.ts:95-96`). Decide which of the two the contract needs.
- **Spec imports.** Import source modules into the spec with `import type` only (`browser-pane-restore.spec.ts:2-4`). A value import runs browser code in the Node runner.
- **Async order.** Let the test decide the order through deferreds the fixture exposes (`mountPluginHost`, `packages/app/component-tests/plugin-host.fixture.tsx:151`). Await the outcome they lead to (`plugin-host.spec.ts:38-69`), or poll in-page state with `until` (`plugin-host.fixture.tsx:141-148`). Do not copy the fixed in-page `setTimeout` waits that other cases in `plugin-host.spec.ts` (`:30`, `:80-82`, `:100-111`) use to prove a negative.

## Vite pre-bundling and reloads

`packages/stories/vite.config.ts` sets `optimizeDeps.entries`: every `*.stories.tsx` and `*.worker.ts` under the four `src/` trees, every module a component spec names by a `./` or `../` string literal ending in `.ts`/`.tsx` (collected at the top of the file), and the frame's `index.html`. Vite pre-bundles their bare imports before the first page loads. A dependency the scan misses is found on first import instead. If that changes chunks already served, Vite logs `✨ optimized dependencies changed. reloading` and sends `full-reload` with path `*` to every page in every worker, and requests with a stale `?v=` hash get a 504 "Outdated Optimize Dep".

- **The bar is zero reloads.** A cold run of either suite should print neither `new dependencies optimized` nor `optimized dependencies changed`, so these lines are the signal to watch.
- **Keep new code reachable by the scan.** A module path built at runtime, in a template literal, or without its extension is not collected, and neither is a spec named other than `*.spec.ts`. Name stories `*.stories.tsx`: the story index and the scan read only that extension. Name workers `*.worker.ts`, since the scan does not follow `new Worker(new URL(…))`. Add an `optimizeDeps.include` entry only for a dependency the scan cannot reach. Vite names it in `✨ new dependencies optimized: …`, and `DEBUG=vite:deps` replaces that line with scan and discovery detail.
- **Symptoms.** "page.evaluate: Execution context was destroyed", "Failed to fetch dynamically imported module …/@fs/…", or fixture state that is gone right after `mount` ("Registrations: 1" not found, an empty tab strip).
- **Only `mount()` survives a reload,** because it navigates back to the same URL. A reload loses everything set up after it: `page.evaluate` imports, mounted fixtures, state from earlier clicks, and the elements your locators pointed at. Another worker's discovery can trigger it at any moment.
- **Fix reloads in the scan, never with retries, timeouts or import order.** The import-everything-before-mount `Promise.all` in `browser-pane-restore.spec.ts:43-58` (comment at `:56`) only narrowed the window. Before the entries existed, that file's `:123` and `:150` were retried in 31 CI jobs each, and failed attempts cost about 39-47 s (Linux) and 34 s (Windows) of worker time per run.
- **Clear the cache whenever entries matter.** Vite's `getConfigHash` covers `optimizeDeps.include`, `resolve` and plugin names, but not `entries`, and a valid `_metadata.json` skips the scan. A warm cache therefore never scans a new story or fixture, so it shows neither the reloads nor the absence of reloads that CI's cold scan would. Delete `packages/stories/node_modules/.vite` before judging.
- **Resolve through package resolution, not paths into `node_modules`.** `vite.config.ts` dedupes `@tanstack/solid-query` instead of aliasing it into `app/node_modules`, a path that exists only under bun's isolated linker. While Windows CI installed hoisted, that alias made every app story fail there, and 23 of 30 runs hit the step's 15-minute cap. CI now runs the same `bun install --frozen-lockfile` on every OS (`.github/actions/setup-bun/action.yml:66-68`), so such an alias would pass CI and still break a hoisted local install.

## Cold vs warm, and what a mount costs

- **CI is always cold.** Each suite runs in its own leg on a fresh runner (`check-test.yml:239-240`), so every leg starts the story server with no cache and runs the full scan.
- **Do not count the first test.** In one CI run of this harness, the first test per worker took 5.7-7.0 s on Linux and 14-15 s on Windows. Warm tests had a median of 1.5 s (app) and 2.0 s (session-ui) on Linux and 2.4-2.6 s on Windows. A warm `mount` (navigation plus root wait) had a median of 1.0 s (app) and 1.5 s (session-ui) on Linux and 1.7-1.9 s on Windows, which is most of a typical test. Judge cost by warm attempts.
- **Local reuse.** Playwright reuses whatever answers on the port (`config.ts:20`; default 6006, `config.ts:3`). That hides cold cost and reloads, and with several worktrees another checkout's story server can serve your tests its own code. Set `PLAYWRIGHT_STORIES_PORT` or `PLAYWRIGHT_STORIES_URL` (`config.ts:3-4`). On Windows pick a port below 49152: the dynamic range starts there, and Hyper-V and WSL reserve blocks inside it (`netsh int ipv4 show excludedportrange protocol=tcp`). Two story servers in one checkout share, and race on, `packages/stories/node_modules/.vite`, so a separate port is not enough: use a separate worktree.
- **Keep mounts few.** Put one scenario in each test, and resize in place with `page.setViewportSize` (`composer.spec.ts:28-29`) instead of mounting again.
  - CI records video only on the first retry, next to the trace; local runs keep `retain-on-failure` (`config.ts:27-30`).

## Mobile, touch and drawers

- **Touch.** Use `story.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })` inside a `story.describe` (`packages/session-ui/component-tests/session-timeline-mobile.spec.ts:3-4`). These options are test-scoped, so the shared workers stay. Prove that emulation took effect with `matchMedia("(hover: none)")` (`composer.spec.ts:244`), and interact with `tap()` or `page.touchscreen.tap` (`session-timeline-mobile.spec.ts:41-42`).
- **No `launchOptions`.** They are worker-scoped, so the file gets its own worker hash and its own workers. App e2e had to move `packages/app/e2e/regression/mobile-timeline-scroll.spec.ts:18` into its own `fullyParallel` project (`packages/app/playwright.config.ts:69-86`) because it otherwise formed one long serial group running alone on a single worker.
- **Drawers.** Below 768 px, pickers open in a bottom drawer (`composer.spec.ts:100-107`).
  - @corvu/drawer 0.2.4 lost a close requested in the first frames after opening: focus stayed trapped in an off-screen sheet and `body` kept `pointer-events: none`. Before the fix, this caused most first-attempt failures of `composer.spec.ts:5`, in 17 of 31 Linux runs.
  - `patches/@corvu%2Fdrawer@0.2.4.patch` (root `package.json` `patchedDependencies`) fixes it, so tests need no wait before pressing Escape or tapping outside.
  - `composer.spec.ts:375-429` guards the patch. It dismisses in-page, before and as `data-opening` appears, because Playwright input cannot target those frames. Upgrading @corvu/drawer drops the patch, so rerun those tests.
  - Before measuring or screenshotting a drawer, wait until it is fully in the viewport and has no `data-transitioning` (`packages/app/e2e/regression/mobile-model-pickers.spec.ts:25-26`).
  - A stuck overlay is a product bug. Fix the product and guard it in-page, as the patch did, rather than waiting it out.

## Geometry, platforms, known failures

- **Fonts.** Inter's `@font-face` has no `font-display` (`packages/app/src/index.css:13-18`), so a story can lay out with fallback metrics and then shift. Windows CI saw 6.5 px in the composer overflow measurement (`composer.spec.ts:93-95`), which now waits first (`:25-26`). Before measuring, run `await page.evaluate(() => document.fonts.ready.then(() => undefined))` (`markdown.spec.ts:247`). The `.then` keeps the `FontFaceSet` from being returned to Node.
- **Page scroll.** Outside fullscreen, the frame's wrapper is `calc(100vh - 2rem)` to fit the page's 1rem padding (`packages/stories/src/frame.tsx`). With `100vh`, every such story scrolled by 32 px, and any scroll-into-view shifted boxes (`composer.spec.ts:116` saw y go from 300 to 268). Do not give a story root `100vh`. A story taller than the viewport still scrolls, so measure relative to a container captured at the same moment, or use `parameters: { layout: "fullscreen" }`.
- **Shortcuts.** Write them as `ControlOrMeta+…` (`browser-pane-restore.spec.ts:134`). Derive expected labels from `navigator.platform` (`packages/app/component-tests/session-question-dock.spec.ts:121`).
- **Known local failure.** On macOS, `browser-pane-restore.spec.ts:123` fails after `ControlOrMeta+w` (Meta+W, `:134-135`), while CI (Control+W) passes. It is not your regression.
- **`story.fail`.** It waits out the full 10 s expect timeout on every run: `packages/session-ui/component-tests/file-tool.spec.ts:49-50` took 12.6 s on Linux CI and 14.8 s on Windows CI. Fix the product instead, or make the expected failure an immediate check once the state has settled.

## Before you push

From the owning package (`packages/session-ui` or `packages/app`):

1. **Repeat** at CI's worker count. Locally retries are already 0 (`config.ts:14`). Every attempt must pass: `bun run test:components -- component-tests/<file>.spec.ts --workers=2 --repeat-each=10`.
2. **Read durations** in `bunx playwright show-report component-tests/playwright-report`. Compare warm tests with the CI medians above. Anything much slower needs a reason in the work the test does.
3. **Rehearse load.** Late font swaps and focus restored after a menu closes (`composer.spec.ts:114-115`) race the test under load. In a throwaway copy of the spec, throttle before `mount` with `const cdp = await page.context().newCDPSession(page)` and then `await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })`. Alternatively, repeat while the other suite runs.
4. **Run each suite cold** whenever you add a story, fixture, dependency, worker or lazy import, or change `packages/stories`. From the repo root, once per suite, as CI runs each in its own leg. Playwright pipes the story server's output into its own (`config.ts:22-23`), and a free port makes it start a fresh server:

   ```sh
   rm -rf packages/stories/node_modules/.vite
   PLAYWRIGHT_STORIES_PORT=6216 bun run --cwd packages/app test:components -- --workers=2 2>&1 | tee /tmp/app-components.log
   grep -E "new dependencies optimized|optimized dependencies changed" /tmp/app-components.log
   ```

   The `grep` must print nothing. Count optimizer events, not durations: under load, the same config ran anywhere from 127 to 189 s.

5. **Windows.** Check platform keys and labels and font-dependent geometry. The Windows component legs are the authoritative check.
   - Do not skip on Windows, and do not raise `config.ts` timeouts, retries or the `mount` wait.
   - If one test does genuinely expensive work, call `story.setTimeout(...)` in that test, with a comment that names the work.
6. **Confirm CI ran the component legs.** E2E never runs on pushes to dev (`check-test.yml:28`), so no post-merge run catches a regression.
   - The `affected` gate filters on `@opencode/app` and `@opencode/stories` (`check-test.yml:60-61`). `ui`, `session-ui` and `gui-plugins` count through app's dependencies. `workflow_dispatch` forces the legs on (`check-test.yml:56-59`).
   - `check-test.yml` is listed in `globalDependencies` (`turbo.json:8`), so editing it marks every package affected.
   - The required `e2e (linux)` and `e2e (windows)` checks also pass when no leg was needed (`check-test.yml:329-352`). Look for `e2e (<os>, session-ui-components)` and `e2e (<os>, app-components)`.
   - If CI skipped them, report your local cold run in the PR.

## When CI flakes

- **Download the artifact.** Run `gh run download <run-id> -n playwright-<linux|windows>-<session-ui|app>-components-<attempt> -D <dir>` (`check-test.yml:314-327`). Results are in `<dir>/session-ui/component-tests/` or `<dir>/app/component-tests/`. Only the first retry has a trace and, in CI, a video: `test-results/<test>-components-retry1/`.
- **Find reloads.** The story server's output reaches the job log with a `[WebServer]` prefix, so grep the log for `optimized dependencies changed`. In the retry trace, a reload shows up as any of:
  - a second frame (`/?id=…`) load and a second `[vite] connecting...`;
  - the deps `?v=` hash changing between requests;
  - 504 "Outdated Optimize Dep" on `deps/*.js`.
