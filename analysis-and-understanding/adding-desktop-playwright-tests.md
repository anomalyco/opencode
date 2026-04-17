# Adding Playwright Tests with Screenshots for Desktop UI

How hard would it be to start covering the OpenCode desktop UI with Playwright + visual regression? Short answer: **medium for Electron (3–5 days), hard for Tauri (weeks, experimental tooling), and trivial for browser-only pixel assertions against the shared SolidJS UI.** The big friction isn't writing tests — it's booting the shell deterministically and wrangling the embedded sidecar.

---

## Three Scopes, Three Difficulty Levels

| Scope | What it actually tests | Difficulty | Effort |
|---|---|---|---|
| **A. Browser-only visual regression** | The SolidJS app running in Chromium (same code both desktops render) | ⭐ Easy | 1–2 days |
| **B. Electron end-to-end** | Real Electron main + renderer + in-process sidecar | ⭐⭐ Medium | 3–5 days (7 if cross-platform CI) |
| **C. Tauri end-to-end** | Real Tauri system webview on each OS | ⭐⭐⭐⭐ Hard | 2–4 weeks, and you'd be pioneering |

Most teams land A + B and skip C.

---

## A. Browser-only Visual Regression (Recommended first step)

Since both desktop shells render the same `@opencode-ai/app` code, running Playwright against that UI in Chromium catches ~90% of visual regressions without any native-shell complexity. The harness is already there — it's what we wired up in `ui-testing-guide.md`.

### What's already in place

- `@playwright/test` wired up in `packages/app`
- Chromium installed via `bunx playwright install chromium`
- `playwright.config.ts` auto-starts Vite, configures `screenshot: "only-on-failure"`, `video: "retain-on-failure"`, `trace: "on-first-retry"`
- Test runs cleanly (`1 skipped` on the `test.fixme()` stub)

### What you'd add

```ts
// packages/app/e2e/smoke.spec.ts
import { test, expect } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  // anti-flake: kill animations, transitions, caret blink
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.addStyleTag({
    content: "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }",
  })
})

test("home renders", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveScreenshot("home.png", { maxDiffPixels: 100 })
})
```

First run creates the baseline under `e2e/__screenshots__/`. Subsequent runs diff against it.

### Known gotchas

- **Font / scrollbar / cursor diffs across machines.** Commit per-platform baselines (`home-darwin.png` vs `home-linux.png`) or run visual tests only on Linux in CI.
- **Backend dependency.** Most real flows need `opencode serve` on `:4096`. Options:
  - Mock with `await page.route("**/api/**", (r) => r.fulfill({ json: fixture }))` — fastest, no backend needed
  - Start a real backend (see `ui-testing-guide.md` § "Running Against a Real Backend")
- **Flaky specs.** Prefer `toHaveScreenshot` with `maxDiffPixels` > `toMatchSnapshot` — it waits for network idle automatically.

### Effort breakdown

| Task | Effort |
|---|---|
| Scaffold anti-flake style helper + test fixture | 2 hours |
| Decide on API mocking strategy and write shared route stubs | 3 hours |
| Land 10 representative snapshot tests (home, session, settings, etc.) | 4 hours |
| Stabilize after first CI flake surface | 0.5–1 day |

**Total: 1–2 days.**

### Value

Catches most UI regressions for both desktops at once. If your goal is "PR screenshots for designers," add Chromatic/Percy/Argos on top of this and stop here.

---

## B. Full Electron E2E with Screenshots

This is the real "desktop UI tests with screenshots" option. Playwright officially supports Electron via `_electron.launch()` — you spawn the Electron binary, get a `Page` per `BrowserWindow`, interact normally.

### Baseline API

```ts
// packages/desktop-electron/e2e/smoke.spec.ts
import { _electron as electron, test, expect } from "@playwright/test"

test("launches and shows main window", async () => {
  const app = await electron.launch({
    args: ["./out/main/index.js", `--user-data-dir=${tmpDir}`],
    env: {
      ...process.env,
      OPENCODE_PORT: "45671",
      OPENCODE_SERVER_PASSWORD: "test-password",
      XDG_STATE_HOME: tmpDir,
      NODE_ENV: "test",
    },
  })

  const window = await app.firstWindow()
  await window.waitForLoadState("domcontentloaded")
  await expect(window).toHaveScreenshot("main.png")
  await app.close()
})
```

### Why this is harder than browser tests (OpenCode-specific)

1. **Embedded sidecar is in-process.** The server ships inside the Electron main bundle via `virtual:opencode-server`. Good news: no subprocess to manage. Bad news: it writes to `XDG_STATE_HOME` (= `app.getPath("userData")`), polluting real user data unless isolated.
   - **Fix:** per-test tmp dir passed via `--user-data-dir=<tmp>` AND matching `XDG_STATE_HOME`/`XDG_DATA_HOME` in `env`.

2. **One-time SQLite migration on first run.** The migration runs on a clean userData dir and can take seconds. Your test must:
   - Wait for the `sqlite-migration-progress` IPC `Done` event before driving the UI, OR
   - Pre-seed `opencode.db` into the tmp dir from a committed fixture to skip migration entirely (faster — probably 10× speed-up).

3. **Sidecar health check is 30 s max.** Cold-start tests need Playwright `test.setTimeout(60_000)` or longer.

4. **Random port + random UUID password every launch.** `main/index.ts` picks a free port; `prepareServerEnv` injects a UUID password. If your test wants to make API calls directly, either:
   - Pin both via `env.OPENCODE_PORT` and `env.OPENCODE_SERVER_PASSWORD` — `prepareServerEnv` merges `process.env` first, so env-provided values win, OR
   - Expose them from the main process via a test-only IPC handler.

5. **`app.setPath("userData")` runs at module top.** The channel-specific suffix (`ai.opencode.desktop.dev`) is applied before `whenReady`. Passing `--user-data-dir` via Chromium CLI overrides Electron's path logic, giving you clean isolation.

6. **Packaged vs unpackaged.** Both work:
   - **Unpackaged (dev):** `args: ["./out/main/index.js"]` after `bun run build`. Fast iteration, good for PR CI.
   - **Packaged:** `executablePath: "./dist/mac-arm64/OpenCode.app/Contents/MacOS/OpenCode"`. Closer to reality. Run nightly, not per-PR.

7. **Loading window complication.** `createLoadingWindow` fires only if migration takes >1 s. With a pre-seeded db, it doesn't appear; with a clean db, it does. `app.firstWindow()` returns whichever pops first — prefer enumerating `app.windows()` and matching by URL (`index.html` vs `loading.html`) or using `app.waitForEvent("window")` with a filter.

8. **Deep links, menus, updater.** These trigger via OS events that tests can't generate directly. Use `app.evaluate(({ BrowserWindow, app }) => app.emit("open-url", {}, "opencode://..."))` to simulate from inside Electron main, or add a test-only IPC to trigger them.

9. **Loopback proxy rewriting.** `ensureLoopbackNoProxy()` mutates `process.env.NO_PROXY` at startup. If your CI sets a proxy, confirm the code path still runs correctly.

### Infrastructure you'd add

```
packages/desktop-electron/
├── e2e/
│   ├── fixtures/
│   │   ├── opencode-prebuilt.db        # pre-migrated SQLite for fast startup
│   │   └── seed-session.json           # canned data if needed
│   ├── helpers/
│   │   ├── launch.ts                   # electron.launch wrapper: tmp dirs, pinned port/password
│   │   ├── screenshot.ts               # anti-flake styles, wait-for-quiet
│   │   └── ipc.ts                      # test-only IPC helpers via app.evaluate
│   ├── fixtures.ts                     # Playwright fixtures: electronApp, mainWindow
│   ├── smoke.spec.ts                   # window opens, title, basic screenshot
│   └── flows/
│       ├── create-session.spec.ts
│       ├── switch-agent.spec.ts
│       └── open-project.spec.ts
├── playwright.config.ts                # separate from packages/app config
└── package.json                        # add test:e2e, test:e2e:ui scripts
```

### Effort breakdown

| Task | Effort |
|---|---|
| Write `launch.ts` with tmp userData, pinned port/password, env plumbing | 0.5 day |
| Playwright fixtures + first smoke test (main window screenshot) | 0.5 day |
| SQLite pre-seed fixture + skip-migration flow | 0.5 day |
| Handle loading window + init-step channel awaits | 0.5 day |
| Write 5–10 real flow specs with screenshots | 1–1.5 days |
| Wire into Turbo (`@opencode-ai/desktop-electron#test:e2e`) + JUnit | 0.5 day |
| Stabilize CI on macOS and Linux (Xvfb) | 0.5–1 day |
| Decide packaged vs unpackaged CI strategy | 0.5 day |

**Total: 3–5 days for one dev comfortable with Playwright Electron; 7 if cross-platform.**

### Why this *isn't* harder

- `_electron` API is stable and Microsoft-maintained
- Your IPC is already typed (`preload/types.ts`), so asserting on `window.api` is straightforward
- Init flow has explicit phases (`InitStep`: `server_waiting` → `sqlite_waiting` → `done`) you can await deterministically
- No Spectron (dead), no WebdriverIO, no CDP shenanigans
- The shell code is thin — ~30 main-process code paths to cover

### What you get

- Real render pipeline, real CSS, real fonts — screenshots match what users see
- Coverage of main-process ↔ renderer IPC contract
- Catches sidecar lifecycle bugs (spawn, health, kill-on-quit)
- Deep-link / menu / updater flows testable via `app.evaluate`
- A base you can extend with accessibility checks (`@axe-core/playwright`), performance budgets, etc.

---

## C. Full Tauri E2E with Screenshots (Not Recommended Yet)

This is where the ecosystem fights you.

### Why it's hard

- **There is no `playwright._tauri` API.** Playwright does not support Tauri.
- Tauri's official test story is **`tauri-driver`**, a WebDriver proxy:
  - **Linux:** wraps `WebKitWebDriver` (via `webkit2gtk`) — works
  - **Windows:** wraps `msedgedriver` — works, sometimes flaky
  - **macOS:** no viable WebDriver for WKWebView — **blocked today**
- Tests would be written in WebdriverIO or Selenium syntax, not Playwright's. Different API, different screenshot tooling, different assertion library.
- You'd have zero automated macOS/Windows Tauri coverage for users (who are most of your user base, because macOS is Tauri's primary target).

### The community workaround

Some projects "test Tauri with Playwright" by disabling the native shell and running the webview content in real Chromium. That's effectively **option A in disguise** — you're not testing Tauri anymore, you're testing the same SolidJS UI we already cover.

### Pragmatic strategy

Unless you specifically need to validate:
- Rust-side behavior (`cli.rs` sidecar spawning via `process-wrap`, `lib.rs::initialize` state machine)
- `tauri-specta` bindings drift (already covered by the `test_export_types` Rust unit test)
- Linux/Windows-specific windowing (Wayland backend toggling, etc.)
- Deep-link registration on each OS

…skip Tauri E2E. Lean on:
- **Option A** for visual coverage of the renderer
- **Option B** (Electron) as your "real native app" coverage tier — same renderer code, so bugs in the UI surface there too
- **Rust `cargo test`** for shell-specific logic (already in place: 27 tests across `cli.rs`, `lib.rs`, `linux_windowing.rs`)
- **Manual release smoke** for the Tauri binary per platform

### Effort if you insist

**2–4 weeks** to get a Linux-only `tauri-driver` + WebdriverIO pipeline stable in CI. Rewrites of assertions into Selenium-style, custom screenshot comparison, no macOS coverage at the end. Value per hour is low.

### When to revisit

Watch for:
- A `playwright._tauri` launcher (community interest exists)
- Tauri 3 shipping a first-party WebDriver for macOS (WKWebView maturing)
- `tauri-driver` gaining macOS support via Safari Technology Preview or similar

Until then, manual smoke is the rational choice.

---

## Realistic Rollout Recommendation

If I were prioritizing this, I'd do:

### Week 1 — Option A

Write real Playwright specs in `packages/app/e2e/` with visual regression. You already have the infra. Catches 90% of UI regressions because both desktop shells render this exact code.

- Replace `todo.spec.ts` with 10 real specs covering top-level routes
- Add anti-flake styling helper + `page.route` API mocks
- Commit per-platform baselines
- Optional: wire Chromatic/Percy/Argos for PR previews

### Week 2 — Option B (Electron)

Stand up `_electron` tests in `packages/desktop-electron/e2e/`.

- Pre-seed SQLite fixture to make cold start fast
- Pin sidecar port + password via env
- Isolate every test via tmp userData dir
- Cover 5–10 critical flows with screenshots
- Gate CI on macOS + Linux (Electron supports both cleanly)

### Defer — Option C (Tauri)

Rely on existing Rust unit tests + manual release smoke. Revisit when the tooling matures.

---

## Goal-Driven Decision Tree

| If your real goal is… | Do this |
|---|---|
| "Designers want to see UI changes in PRs" | Option A + Chromatic/Percy. Done in 1–2 days. |
| "Catch visual regressions in the UI" | Option A. Start here. |
| "Catch bugs specific to the desktop shell" (IPC drift, sidecar lifecycle, deep links, updater) | Option B. A won't help you. |
| "Pixel-perfect coverage of the packaged app users install" | Option B (packaged mode, nightly CI) + manual per-release smoke for Tauri. |
| "Full cross-shell, cross-platform automation" | Not achievable today for Tauri. Accept B + manual for macOS Tauri. |

---

## Key Technical Decisions You'll Need to Make

1. **Visual regression tool:** native Playwright `toHaveScreenshot` (free, per-platform baselines in repo) vs Chromatic/Percy/Argos (hosted, PR comments, cross-machine stable).
2. **Backend strategy for UI tests:** API mocks via `page.route` (fast, isolated) vs real `opencode serve` (realistic, slower, flaky).
3. **SQLite startup:** pre-seeded fixture (fast, one code path) vs fresh migration each run (slow, tests the migration itself).
4. **CI matrix:** macOS-only (covers most devs), Linux-only (cheapest, stable), or both (ideal).
5. **Packaged vs unpackaged Electron:** PR runs unpackaged (fast), nightly runs packaged (real-world).
6. **Test-only IPC surface:** add conditional handlers (`if (process.env.NODE_ENV === "test")`) or use `app.evaluate` in Playwright to drive main directly (no production code changes).

---

## Why Electron Is the Sweet Spot

- Playwright + Electron is a first-party, documented, maintained combo
- Your IPC is already typed and centralized
- The init flow is state-machine-driven with observable phases
- The shell is thin; most complexity lives in `@opencode-ai/app` which is also testable standalone
- The sidecar being in-process means one-less-thing to manage from tests
- Hard parts (tmp dirs, port/password pinning, SQLite fixture, loading-window timing) all have known single-afternoon solutions

The Tauri shell is harder not because OpenCode's architecture is wrong, but because the broader Tauri + Playwright ecosystem hasn't caught up yet.

---

## Starter Scaffold (What I'd Write First)

Minimum viable Electron E2E to prove the path:

```ts
// packages/desktop-electron/e2e/helpers/launch.ts
import { mkdtempSync, copyFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _electron, type ElectronApplication } from "@playwright/test"

export async function launch(opts: { seedDb?: boolean } = {}): Promise<{ app: ElectronApplication; userDataDir: string }> {
  const userDataDir = mkdtempSync(join(tmpdir(), "opencode-e2e-"))
  const dataDir = join(userDataDir, "opencode")
  mkdirSync(dataDir, { recursive: true })

  if (opts.seedDb) {
    copyFileSync(join(__dirname, "../fixtures/opencode-prebuilt.db"), join(dataDir, "opencode.db"))
  }

  const app = await _electron.launch({
    args: [join(__dirname, "../../out/main/index.js"), `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      OPENCODE_PORT: "45671",
      OPENCODE_SERVER_PASSWORD: "test-password",
      XDG_STATE_HOME: userDataDir,
      XDG_DATA_HOME: userDataDir,
      NODE_ENV: "test",
    },
    timeout: 60_000,
  })

  return { app, userDataDir }
}
```

```ts
// packages/desktop-electron/e2e/smoke.spec.ts
import { test, expect } from "@playwright/test"
import { launch } from "./helpers/launch"

test("main window opens with seeded db", async () => {
  test.setTimeout(60_000)
  const { app } = await launch({ seedDb: true })

  const window = await app.firstWindow()
  await window.waitForLoadState("domcontentloaded")
  await window.emulateMedia({ reducedMotion: "reduce" })

  await expect(window).toHaveScreenshot("smoke-main.png", { maxDiffPixels: 200 })
  await app.close()
})
```

```ts
// packages/desktop-electron/playwright.config.ts
import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { outputFolder: "e2e/playwright-report", open: "never" }], ["line"]],
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
})
```

Adding this plus a matching `bun run build` prereq and `test:e2e` script gets you the first green screenshot in under a day.

---

## TL;DR

- **Option A (browser-only visual):** 1–2 days. Do this first. Covers most regressions.
- **Option B (Electron E2E):** 3–5 days. Real native coverage, real screenshots, well-supported tooling. Worth doing.
- **Option C (Tauri E2E):** weeks, experimental, no macOS coverage. Skip until the ecosystem matures.

The OpenCode codebase is well-suited for Playwright Electron specifically because it already has typed IPC, observable init phases, and a thin shell. The blockers are environmental (tmp dirs, port pinning, SQLite fixture) — each is a 2–4 hour fix.
