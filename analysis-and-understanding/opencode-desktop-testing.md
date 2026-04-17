# OpenCode Desktop — Testing Strategy

**Short answer: the desktop packages themselves have almost no tests. Essentially no unit runner, no integration tests, no Playwright, no Spectron/WebdriverIO. Testing is done at layers below.**

---

## What exists in the desktop packages

### `packages/desktop` (Tauri) — no JS tests, only Rust unit tests

- **No `test` script** in `package.json`. The only script-level checks are `typecheck` and the `tauri` build/dev runners.
- Rust side has inline `#[cfg(test)] mod tests` blocks in three files (`src-tauri/src/`):
  - `linux_windowing.rs` — **22** `#[test]` functions (the bulk of the tests in the whole desktop surface)
  - `cli.rs` — **4** `#[test]` functions (shell env / path logic around the sidecar)
  - `lib.rs` — **1** `#[test]` `test_export_types` that re-runs the `tauri-specta` generator to ensure `src/bindings.ts` is up-to-date
- Run with `cargo test` from `packages/desktop/src-tauri` — standard Rust test harness.
- **Not wired to Turbo.** No CI target in `turbo.json`.
- No `@tauri-apps/webdriver`, no `tauri driver`, no Playwright fixture — nobody is driving the webview end-to-end.

### `packages/desktop-electron` — two Bun unit tests, that's it

- Also **no `test` script** in `package.json` (only `typecheck`, `predev`, `dev`, `prebuild`, `build`, `package*`).
- The two files that exist use `bun:test`:
  - `src/main/shell-env.test.ts` — pure-function tests for `parseShellEnv`, `mergeShellEnv`, `isNushell` (no Electron runtime)
  - `src/renderer/html.test.ts` — reads `index.html` / `loading.html` as files and asserts relative paths (because `loadFile()` breaks with absolute paths in Electron) plus a Vite config sanity check
- Both run under plain `bun test` — neither boots Electron, neither mocks `electron` APIs, both test pure logic or static files.
- **No Playwright, no Spectron, no `playwright-electron`.** No integration harness that launches the Electron app.

---

## Why this is OK (where the real tests live)

Desktop is intentionally a thin shell, so the testing strategy pushes testing down two levels:

### 1. The UI (`packages/app`)

This is what both desktop shells render, and it has the full test infra:

- `bun test --preload ./happydom.ts ./src` → SolidJS unit/component tests in happy-dom
- `@playwright/test` with `playwright.config.ts` running a chromium project against Vite `webServer` on port 3000, targeting a real backend via `VITE_OPENCODE_SERVER_HOST`/`VITE_OPENCODE_SERVER_PORT` (e.g. `4096`)
- `e2e/todo.spec.ts` is currently the only spec; retries=2 and trace/screenshot/video on failure in CI
- Scripts: `test`, `test:unit`, `test:unit:watch`, `test:e2e`, `test:e2e:ui`, `test:e2e:report`, `test:ci` (JUnit output to `.artifacts/unit/junit.xml`)
- Wired in `turbo.json` as `@opencode-ai/app#test` and `@opencode-ai/app#test:ci`

### 2. The server/agent (`packages/opencode`)

Which both shells boot as a sidecar — has `bun test --timeout 30000` (scripts `test`, `test:ci`), and is the `opencode#test` / `opencode#test:ci` task in Turbo.

---

## Practical dev workflow

- **Unit-testing main-process logic (Electron):** put it in `src/main/*.ts` as a pure function, add a `*.test.ts` next to it, run `bun test src/main/shell-env.test.ts` from `packages/desktop-electron`. That's the pattern `shell-env.test.ts` establishes.
- **Unit-testing Rust helpers (Tauri):** add `#[cfg(test)] mod tests` in-file and run `cargo test` from `packages/desktop/src-tauri`. Anything platform-gated (`#[cfg(target_os = "linux")]`) only runs on that host.
- **Integration/E2E on real UI behavior:** write a Playwright spec in `packages/app/e2e/*.spec.ts` and run `bun run test:e2e` there. It runs against the Vite dev server + a real `opencode serve` backend — not through the Electron/Tauri shell. **You cannot currently `playwright.open` the packaged desktop app; there is no such harness.**
- **Verifying the IPC contract:**
  - **Tauri:** the `test_export_types` Rust test regenerates `src/bindings.ts`. If CI sees `bindings.ts` diverge from what `specta` produces, you know a command drifted.
  - **Electron:** `preload/types.ts` is hand-written, so contract drift is caught by `bun typecheck` (`tsgo -b`) across main/preload/renderer — there is no runtime IPC test.
- **Typecheck is the de-facto test for the shells:** `bun typecheck` from each desktop package (runs `tsgo -b`) + `cargo check`/`cargo build` for Rust is what actually gates most PRs touching shell code.

---

## Gaps worth noting

- There is **no automated test** that launches either shell and verifies the sidecar spawn → health-check → main-window handshake. That flow is validated manually via `bun run --cwd packages/desktop tauri dev` / `bun run --cwd packages/desktop-electron dev`.
- No test covers the `await_initialization` / `InitStep` streaming channel contract end-to-end.
- No test for deep-link handling, auto-updater flows, or the loading-window trigger heuristic (>1 s sqlite migration).
- Playwright exists but is scoped to `packages/app` against the browser build; it does not exercise `Platform` desktop implementations (`@tauri-apps/plugin-*`, `window.api`).

---

## Summary Matrix

| Layer                                  | Unit              | Integration | E2E                  |
|----------------------------------------|-------------------|-------------|----------------------|
| `packages/desktop` Rust (`src-tauri`)  | `cargo test` (27 tests) | — | — |
| `packages/desktop` TS renderer         | —                 | —           | —                    |
| `packages/desktop-electron` main       | `bun test` (1 file)| —          | —                    |
| `packages/desktop-electron` renderer   | `bun test` (1 file, static HTML only) | — | —       |
| `packages/app` (shared UI)             | `bun test` + happy-dom | — | Playwright (chromium, `packages/app/e2e`) |
| `packages/opencode` (sidecar/server)   | `bun test` (`opencode#test` in Turbo) | — | — |

---

## TL;DR

Desktop has no Playwright, no Electron E2E harness, no Tauri WebDriver. It has a handful of Rust unit tests (mostly Linux window logic + specta export verification) and two Bun unit tests in Electron (shell-env parsing + HTML static analysis). Everything real — component tests, E2E — lives in `packages/app` (Playwright against the web build) and `packages/opencode` (`bun test`). **Typecheck is the primary safety net for shell code.**
