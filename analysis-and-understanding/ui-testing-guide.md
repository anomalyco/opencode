# UI Testing Guide (OpenCode)

How to test UI in this repo — what each tier actually does, where tests live, and how to run them. The short version: **almost everything here is headless**, and the one tool that produces screenshots is essentially unused today.

---

## The Three Tiers

| Tier | Tool | File pattern | Runs in | Sees pixels? | Count in repo |
|---|---|---|---|---|---|
| Unit / logic | `bun test` | `*.test.ts` (many in `test/` dirs) | Bun runtime (no DOM) | ❌ No | ~173 files |
| Component / DOM | `bun test --preload ./happydom.ts` | `*.test.ts` co-located with source | Bun + **happy-dom** (simulated DOM) | ❌ No (DOM exists in memory, never rendered) | ~52 files (all `packages/app`) |
| E2E | `playwright test` | `e2e/*.spec.ts` | Real **Chromium** browser | ✅ Yes — screenshots, videos, traces on failure | **1 file** (a `test.fixme()` stub) |

### Bun tests are headless

`bun:test` is Bun's built-in Jest/Vitest-compatible runner. Code runs directly in the Bun runtime — no browser, no Electron, no Tauri webview. Output is plain pass/fail text. No `page`, no `click()`, no screenshots, ever.

```ts
import { describe, expect, test } from "bun:test"

describe("foo", () => {
  test("bar", () => {
    expect(1 + 1).toBe(2)
  })
})
```

### happy-dom tests are also headless (even though they test components)

The 52 files in `packages/app` preload `happydom.ts`, which registers `document`, `window`, `Element`, etc. as globals into the Bun process. Solid components mount into a detached `<div>` and assertions check `textContent`, attributes, dispatched events. There is **no layout, no paint, no CSS rendering** — happy-dom doesn't run a compositor. You can't screenshot what isn't rendered.

```ts
import { render } from "solid-js/web"
import { test, expect } from "bun:test"

test("renders title", () => {
  const div = document.createElement("div")
  render(() => <MyComponent title="hi" />, div)
  expect(div.textContent).toContain("hi")
})
```

### Playwright E2E is the only source of visuals

And it's currently empty. Screenshots/videos exist in the config but only fire on failure, and there's nothing substantive to fail:

```ts
// packages/app/playwright.config.ts
use: {
  trace: "on-first-retry",
  screenshot: "only-on-failure",
  video: "retain-on-failure",
}
```

So nothing visual is being generated anywhere in the project today.

---

## Running Bun Tests

The default branch is `dev`. Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from each package directory.

### `packages/opencode` — unit + integration (157 files)

```bash
cd packages/opencode
bun test                                     # everything
bun test test/session                        # a subtree
bun test test/session/session.test.ts        # one file
bun test --watch                             # re-run on save
```

Mirrors `src/` under `test/`: `test/session/`, `test/util/`, `test/tool/`, `test/cli/tui/`, `test/plugin/`, `test/file/`, `test/server/`, `test/cli/`, `test/project/`, `test/mcp/`, `test/effect/`, `test/config/`, `test/provider/` (+ `copilot/`), `test/lsp/`, `test/storage/`, `test/pty/`, `test/bus/`, `test/skill/`, `test/permission/`, `test/control-plane/`, plus a few at `test/` root.

### `packages/app` — components + utilities (52 files)

These need happy-dom preloaded:

```bash
cd packages/app
bun run test:unit                            # = bun test --preload ./happydom.ts ./src
bun run test:unit:watch                      # same, --watch
bun run test                                 # alias for test:unit
```

Organized by role: `src/utils/` (11), `src/context/` (11 + `context/global-sync/` 6), `src/pages/session/` (6), `src/components/prompt-input/` (6), `src/components/` (3).

### Other packages

```bash
cd packages/ui && bun test                   # 5 files
cd packages/shared && bun test               # 2 files
cd packages/console && bun test              # 3 files
cd packages/enterprise && bun test           # 2 files
cd packages/desktop-electron && bun test     # 2 files (shell-env + html)
```

### Testing conventions (from repo `AGENTS.md`)

- **Avoid mocks** as much as possible
- **Test actual implementation**; don't duplicate logic into tests
- Never `cd` then run — use the package directory directly

---

## Running Playwright (the only visual option)

### TL;DR

From `packages/app/`:

```bash
PLAYWRIGHT_PORT=3030 bun run test:e2e -- --headed
```

Result today: `1 skipped`. The only spec is `e2e/todo.spec.ts`, a `test.fixme()` placeholder. Getting it to skip cleanly means the pipeline (Bun → Vite webServer → Playwright → Chromium) is wired end-to-end.

### First-time setup

OpenCode pins Bun in its root `package.json` (`"packageManager": "bun@1.3.11"`) and uses Bun-only APIs like `Bun.file()`. npm/pnpm won't work.

```bash
# 1. Install Bun if missing
brew install oven-sh/bun/bun          # or: curl -fsSL https://bun.sh/install | bash

# 2. Install workspace deps (from repo root)
bun install

# 3. Install the Chromium browser binary (from packages/app)
bunx playwright install chromium      # add --with-deps on Linux
```

### The port-3000 gotcha

`packages/app/playwright.config.ts` defaults the Vite `webServer` to port **3000**. If something else is on that port (Docker Desktop commonly holds 3000–3002), Vite auto-shifts and Playwright waits 120 s on the wrong port, then fails with:

```
Error: Timed out waiting 120000ms from config.webServer.
```

Detect:

```bash
lsof -nP -iTCP:3000 -iTCP:3001 -iTCP:3002 -sTCP:LISTEN
```

Avoid — set an explicit free port. The same env var feeds both Vite and Playwright:

```bash
PLAYWRIGHT_PORT=3030 bun run test:e2e -- --headed
```

### Commands

All from `packages/app/`:

```bash
# Headed — watch Chromium
PLAYWRIGHT_PORT=3030 bun run test:e2e -- --headed

# Headless (fast, matches CI)
PLAYWRIGHT_PORT=3030 bun run test:e2e

# Interactive UI mode — best for writing/debugging specs
PLAYWRIGHT_PORT=3030 bun run test:e2e:ui

# Single spec
PLAYWRIGHT_PORT=3030 bunx playwright test e2e/todo.spec.ts --headed

# Codegen — record a test by clicking
PLAYWRIGHT_PORT=3030 bunx playwright codegen http://127.0.0.1:3030

# Open the last HTML report
bun run test:e2e:report
```

### What the config provides

From `packages/app/playwright.config.ts`:

- `testDir: "./e2e"`, `outputDir: "./e2e/test-results"`
- 60 s test timeout, 10 s `expect` timeout
- CI: 2 retries; local: 0
- Single project: `chromium` with `devices["Desktop Chrome"]`
- `webServer.command` = `bun run dev -- --host 0.0.0.0 --port ${PLAYWRIGHT_PORT ?? 3000}` with 120 s boot window and `reuseExistingServer: !CI`
- Env passed into Vite: `VITE_OPENCODE_SERVER_HOST` (default `127.0.0.1`), `VITE_OPENCODE_SERVER_PORT` (default `4096`)
- Reporters: HTML (`e2e/playwright-report`) + line; adds JUnit when `PLAYWRIGHT_JUNIT_OUTPUT` is set
- Failure artifacts: trace on first retry, screenshot only on failure, video retained on failure

### Env vars worth knowing

| Variable | Purpose |
|---|---|
| `PLAYWRIGHT_PORT` | Port Vite + Playwright share (workaround for 3000 conflict) |
| `PLAYWRIGHT_BASE_URL` | Full URL override (e.g. remote deploy) |
| `PLAYWRIGHT_SERVER_HOST` | Forwarded to Vite as `VITE_OPENCODE_SERVER_HOST` |
| `PLAYWRIGHT_SERVER_PORT` | Forwarded to Vite as `VITE_OPENCODE_SERVER_PORT` |
| `PLAYWRIGHT_WORKERS` | Parallel workers (5 in CI by default, auto local) |
| `PLAYWRIGHT_FULLY_PARALLEL` | `"1"` to parallelize within files |
| `PLAYWRIGHT_JUNIT_OUTPUT` | Path to write JUnit XML for CI |

### Running against a real backend

The config only starts Vite — not `opencode serve`. If your spec hits API routes, start the backend in a second terminal first:

```bash
# Terminal 1 — backend (from packages/opencode)
bun run --conditions=browser ./src/index.ts serve --port 4096

# Terminal 2 — tests (from packages/app)
PLAYWRIGHT_PORT=3030 \
  PLAYWRIGHT_SERVER_HOST=127.0.0.1 \
  PLAYWRIGHT_SERVER_PORT=4096 \
  bun run test:e2e -- --headed
```

Defaults already point at `127.0.0.1:4096`, so the `PLAYWRIGHT_SERVER_*` vars are optional if your backend matches.

**Per `packages/app/AGENTS.md`: never restart the app or server process during a debugging session** — start it once and leave it running.

### Current state of the E2E suite

`packages/app/e2e/todo.spec.ts` is the only spec:

```ts
import { test } from "@playwright/test"

test(
  "test something cool",
  { annotation: { type: "todo" } },
  async () => {
    test.fixme()
  },
)
```

`test.fixme()` marks it as a known-broken placeholder, so it always skips. **There is no substantive E2E coverage today.** Getting Playwright to run successfully currently just proves the harness works; writing real specs is the next step.

---

## First-Run Reproduction Log

```
$ which bun
bun not found

$ brew install oven-sh/bun/bun
...
🍺  /opt/homebrew/Cellar/bun/1.3.12: 8 files, 61.5MB, built in 2 seconds

$ cd opencode && bun install
...
4764 packages installed [32.03s]

$ cd packages/app && bunx playwright install chromium
(installs Chromium binary)

$ bun run test:e2e -- --headed
$ playwright test --headed
[WebServer] $ vite --host "0.0.0.0" --port "3000"
Error: Timed out waiting 120000ms from config.webServer.

$ lsof -nP -iTCP:3000 -iTCP:3001 -iTCP:3002 -sTCP:LISTEN
COMMAND PID NAME
com.docke 14869 *:3000
com.docke 14869 *:3001
com.docke 14869 *:3002

$ PLAYWRIGHT_PORT=3030 bun run test:e2e -- --headed
$ playwright test --headed
[WebServer] $ vite --host "0.0.0.0" --port "3030"
Running 1 test using 1 worker
[1/1] [chromium] › e2e/todo.spec.ts:3:1 › test something cool
  1 skipped
```

---

## Which Tier Should I Use?

- **Assert logic, data flow, types, service composition** → `bun test` (fast, hundreds of ms, no window)
- **Assert that a component renders the right text/attrs/events** → `bun test` + happy-dom (still no window, simulated DOM only)
- **See the app, take screenshots, check CSS rendering, click real elements, assert navigation** → Playwright (basically unwritten here; you'll be adding the first real specs)

Desktop shells (`packages/desktop`, `packages/desktop-electron`) have their own tiny unit coverage (Rust `#[test]` and Bun `*.test.ts`). Neither has Playwright, Spectron, or `tauri driver` — there is no automated test that launches the packaged native app today. See `opencode-desktop-testing.md` for that deeper story.

---

## Troubleshooting

- **`Timed out waiting 120000ms from config.webServer`** → port conflict. Check `lsof`, set `PLAYWRIGHT_PORT`.
- **`browserType.launch: Executable doesn't exist at .../chromium...`** → you skipped `bunx playwright install chromium`.
- **`command not found: bun`** → `brew install oven-sh/bun/bun`.
- **`1 skipped` every run** → expected. The only spec is `test.fixme()`. Write a real one.
- **HMR / "Page closed" errors headed** → spec finishing before the page stabilizes; add `await expect(page).toHaveURL(...)` or `await page.waitForLoadState("networkidle")`.
- **CI-only failures** → CI enables `retries: 2` and (optionally) `fullyParallel`. Reproduce locally with `CI=1 PLAYWRIGHT_FULLY_PARALLEL=1 bun run test:e2e`.
- **happy-dom test `ReferenceError: document is not defined`** → run through `packages/app`'s scripts (`bun run test:unit`), not raw `bun test` — those scripts pass `--preload ./happydom.ts`.
- **"do-not-run-tests-from-root" error** → `bun test` must be invoked from a package directory, not repo root.
