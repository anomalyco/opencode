# Copilot instructions — sdks/vscode (VS Code extension)

Purpose: concise, extension-focused guidance for Copilot/automation sessions working inside sdks/vscode.

---

## Quick setup & prerequisites

- Requirements: Bun 1.3+ and VS Code Insiders (the extension uses proposed APIs).
- From the repo root (or any path):
  - cd sdks/vscode
  - bun install
- Open this folder in VS Code Insiders (do NOT open the repo root when debugging the extension).
- Ensure a local `opencode` CLI is on your PATH if testing CLI-related behavior; the extension launches the CLI as an ACP subprocess.

## Build / compile / lint

- Compile the extension bundle: `bun run compile`
- Package for publishing (prepublish hook): `bun run package` (used by `vscode:prepublish`)
- Lint: `bun run lint` (runs `eslint src`)
- Typecheck: `bun run check-types`
- Watchers for development:
  - `bun run watch:esbuild` (esbuild watcher)
  - `bun run watch:tsc` (tsc watcher)
  - `bun run watch-tests` (compiles tests in watch mode)

Note: esbuild and tsc watchers are started automatically when launching the debug session (F5).

## Tests (unit & extension e2e)

- Compile tests: `bun run compile-tests` (runs `tsc -p tsconfig.test.json`)
- Run all extension tests (Extension Host): `bun run test` (runs `vscode-test run --config .vscode-test.mjs`)
- CI/headless e2e runs (examples):
  - `bun run test:e2e:stable`
  - `bun run test:e2e:insiders`
- Run tests in watch mode: `bun run watch-tests`

### Running a single extension test (recommended flow)

1. Compile tests: `bun run compile-tests`
2. Create a temporary test runner config (example: `.vscode-test.single.mjs`) that narrows `files` to the compiled test you want to run:

```js
import { defineConfig } from "@vscode/test-cli"

export default defineConfig([
  {
    label: "single",
    files: "out/test/e2e/path/to/your.test.js",
    version: "insiders",
    launchArgs: ["--enable-proposed-api=sst-dev.opencode"],
    mocha: { ui: "tdd", timeout: 60000 }
  }
])
```

3. Run the runner with the config:

```bash
npx @vscode/test-cli run --config .vscode-test.single.mjs
```

Alternative quick iteration (unit tests that do NOT require the Extension Host):

```
node out/test/unit/your.test.js
# or
npx mocha out/test/unit/your.test.js
```

## Debugging the extension

- Open `sdks/vscode` in VS Code Insiders and press F5 (launch config includes the proposed API flag).
- To launch VS Code manually with the proposed API enabled:

```
code-insiders --enable-proposed-api sst-dev.opencode
```

- For CLI/server integration debugging, ensure the `opencode` CLI in your PATH is the dev binary you expect the extension to invoke.
- Use Developer: Reload Window (Cmd/Ctrl+Shift+P) to pick up rebuilt extension files without restarting the debug host.

## High-level architecture (sdks/vscode)

- Source: `sdks/vscode/src/` (TypeScript) → bundled by `esbuild.js` → `sdks/vscode/dist/` (runtime `dist/extension.js`).
- Tests compile into `out/test/` (unit vs e2e subfolders).
- `.vscode-test.mjs` defines Extension Host e2e runs (labels `e2e-stable` & `e2e-insiders`) and points at `out/test/e2e/**/*.test.js`.
- The extension:
  - Uses the proposed `chatSessionsProvider` API to provide chatParticipants/chatSessions.
  - Launches the `opencode` CLI as an ACP subprocess for terminal sessions.
  - Contributes commands such as `opencode.openTerminal`, `opencode.openNewTerminal`, and `opencode.addFilepathToTerminal`.

## Key conventions & patterns (extension-specific)

- Always open `sdks/vscode` folder in VS Code Insiders for development and debugging (proposed APIs are required).
- Prefer running scripts from inside the package directory; from repo root you can use `bun run --cwd sdks/vscode <script>`.
- `pretest` compiles tests and builds the extension; lint can run during pretest (may run more than once).
- esbuild + tsc watchers run automatically during debugging; rely on Reload Window for fast iteration.
- Extension-host e2e tests require the compiled test artifacts under `out/test/e2e/` and the `.vscode-test.mjs` runner configuration.
- Mocha config (in `.vscode-test.mjs`) uses `tdd` UI and `mochawesome` reporter; reports are emitted to `test-results/`.

## Files to consult (shortlist)
- `sdks/vscode/README.md` — development notes & special instructions
- `sdks/vscode/package.json` — package scripts (compile, test, lint, watch)
- `sdks/vscode/.vscode-test.mjs` — Test runner config for Extension Host e2e
- `sdks/vscode/esbuild.js` — bundling/build logic
- `sdks/vscode/src/` — source and tests
- `sdks/vscode/tsconfig*.json` and `tsconfig.test.json`

---

CI / MCP servers

- A GitHub Actions workflow has been added at `.github/workflows/vscode-e2e.yml` to run extension E2E tests for both `stable` and `insiders` channels. It triggers on pushes and PRs that touch `sdks/vscode/**`, uses Bun to install dependencies, and runs the existing `bun run test:e2e:stable` / `bun run test:e2e:insiders` scripts under xvfb for headless execution. Mochawesome reports are uploaded as job artifacts to the workflow run and can be downloaded from the Actions UI (path: `sdks/vscode/test-results`).

Summary: this file provides focused instructions for extension development inside `sdks/vscode`; say if you want adjustments or further CI integration.
