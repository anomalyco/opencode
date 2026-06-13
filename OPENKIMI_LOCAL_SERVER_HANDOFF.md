# OpenKimi Local Server Handoff

This note documents the June 7, 2026 debug session for the OpenKimi desktop
startup issue. It is intended as a fast reference for future agents working in
this fork.

## Current Checkout

- Workspace root supplied by Codex: `/Users/julien/Documents/Documents - Julien's MacBook Air/OpenCode-Kimi`
- Actual project/repo root: `/Users/julien/Documents/Documents - Julien's MacBook Air/OpenCode-Kimi/openkimi`
- Branch observed during the fix: `dev...origin/dev`
- The parent `OpenCode-Kimi` folder is not a git repo; run git commands from
  `openkimi/`.
- The worktree had many pre-existing modified and untracked OpenKimi conversion
  files. Do not revert unrelated changes.

Files changed by this local-server fix:

- `packages/desktop/src/main/index.ts`
- `packages/desktop/src/main/server.ts`
- `packages/desktop/src/main/sidecar.ts`

This handoff doc was added after the fix:

- `OPENKIMI_LOCAL_SERVER_HANDOFF.md`

## User-Visible Symptom

The Electron window opened to a dark retry screen:

```text
Could not reach Local Server
Retrying automatically...
```

The key point: this screen is produced by the app-level server health gate. It
does not automatically mean the Kimi bridge, Moonshot API, or model provider is
down.

## Desktop Startup Path

Development launch command:

```bash
bun run dev:desktop
```

What that does:

1. Root script runs `bun --cwd packages/desktop dev`.
2. `packages/desktop` runs `predev`, which copies icons and builds the embedded
   server bundle via `cd ../opencode && bun script/build-node.ts`.
3. `electron-vite dev` builds:
   - `packages/desktop/src/main/index.ts`
   - `packages/desktop/src/main/sidecar.ts`
   - preload and renderer bundles
4. Main process chooses a loopback port, generates a random password, and calls
   `spawnLocalServer(...)`.
5. `spawnLocalServer(...)` forks the Electron utility process running
   `out/main/sidecar.js`.
6. The sidecar imports `virtual:opencode-server`, which resolves to
   `packages/opencode/dist/node/node.js`, then starts `Server.listen(...)`.
7. Main process resolves `window.api.awaitInitialization()` with
   `{ url, username, password }`.
8. Renderer registers that connection as `Local Server`.
9. The app health gate calls `/global/health`; the global sync path opens
   `/global/event`.

Relevant source paths:

- `packages/desktop/src/main/index.ts`
- `packages/desktop/src/main/server.ts`
- `packages/desktop/src/main/sidecar.ts`
- `packages/desktop/src/renderer/index.tsx`
- `packages/app/src/app.tsx`
- `packages/app/src/utils/server-health.ts`
- `packages/app/src/context/server-sdk.tsx`

## Root Cause

The local sidecar server was healthy, but the renderer was given the wrong Basic
Auth username.

Before the fix:

- Sidecar server listened with username `opencode`.
- Main-process health check also used username `opencode`.
- Renderer was handed username `openkimi`.

That meant the main process proved the sidecar was up, then the renderer called
the same sidecar with the wrong username. The UI health check failed and showed
`Could not reach Local Server`.

Observed supporting log pattern before the fix:

- `main.log`: sidecar connection started, sidecar loaded, `server ready`.
- `server.log`: only the expected Node SQLite experimental warning.
- `renderer.log`: `[global-sdk] event stream error [object Object]`.

This was an OpenKimi desktop auth mismatch, not a Kimi ACP bridge problem.

## Fix Applied

The fix keeps one shared sidecar auth username in the desktop main layer and
uses it everywhere.

In `packages/desktop/src/main/server.ts`:

- Added:

```ts
export const SIDECAR_AUTH_USERNAME = "opencode"
```

- `spawnLocalServer(...)` now sends `username: SIDECAR_AUTH_USERNAME` in the
  utility-process start command.
- `checkHealth(...)` now accepts a username defaulting to
  `SIDECAR_AUTH_USERNAME` and uses it when building the Basic Auth header.

In `packages/desktop/src/main/sidecar.ts`:

- `StartCommand` now includes `username`.
- `parseCommand(...)` validates `username`.
- `prepareSidecarEnv(...)` writes `OPENCODE_SERVER_USERNAME` from the command.
- `Server.listen(...)` uses `command.username`.

In `packages/desktop/src/main/index.ts`:

- The renderer initialization payload now returns:

```ts
username: SIDECAR_AUTH_USERNAME
```

Why the value is still `opencode`: the embedded server/auth layer is still
OpenCode-derived and expects `OPENCODE_SERVER_USERNAME`. Do not rename this to
`openkimi` unless the underlying server auth contract is also updated and tested.

## Verification Performed

Development launch:

```bash
bun run dev:desktop
```

Fresh post-fix run log directory:

```text
~/Library/Application Support/dev.openkimi.desktop.dev/logs/20260606T225031
```

Important post-fix log lines:

```text
sidecar connection started { url: 'http://127.0.0.1:63405' }
spawning sidecar { url: 'http://127.0.0.1:63405' }
loading task finished
awaiting server ready
server ready { url: 'http://127.0.0.1:63405' }
```

Post-fix renderer log no longer showed the earlier
`[global-sdk] event stream error` after `server ready`. It only showed unrelated
development/browser warnings such as CSP, autofocus, and aria-hidden focus
warnings.

Build verification:

```bash
bun run --cwd packages/desktop build
```

Result: passed.

Expected non-fatal warnings during build:

- `oc-theme-preload.js` script cannot be bundled without `type="module"`.
- `virtua` JSX import source warning.
- Several Vite dynamic/static import chunking warnings for i18n/theme modules.
- A duplicate source map emitted-file warning.

Whitespace check:

```bash
git diff --check -- \
  packages/desktop/src/main/index.ts \
  packages/desktop/src/main/server.ts \
  packages/desktop/src/main/sidecar.ts
```

Result: passed.

Typecheck attempted:

```bash
bun run --cwd packages/desktop typecheck
```

Result: failed for pre-existing workspace issues, not this patch. Main failure
categories:

- `TS6305` declaration outputs under `packages/app/node_modules/.ts-dist` had
  not been built from source files.
- Existing implicit-`any` errors in desktop/menu, WSL server, preload, and
  renderer code.

## Useful Debug Commands

Find latest OpenKimi desktop log run:

```bash
ls -td "$HOME/Library/Application Support/dev.openkimi.desktop.dev/logs"/* | head -1
```

Inspect the important logs:

```bash
run="$(ls -td "$HOME/Library/Application Support/dev.openkimi.desktop.dev/logs"/* | head -1)"
tail -120 "$run/main.log"
tail -120 "$run/server.log"
tail -120 "$run/renderer.log"
tail -120 "$run/utility.log"
```

Check whether the development app is still listening:

```bash
lsof -nP -iTCP -sTCP:LISTEN | rg 'dev.openkimi|Electron|:5173|:9222'
```

Check Electron devtools targets:

```bash
curl -s http://127.0.0.1:9222/json/list
```

Find lingering OpenKimi development processes:

```bash
pgrep -fl 'electron-vite|OpenKimi|dev.openkimi|packages/desktop|bun --cwd packages/desktop dev|Electron Helper.*dev.openkimi'
```

Terminate only the OpenKimi dev stack you started:

```bash
kill -TERM <pids>
```

Do not kill unrelated Electron apps such as Codex, VS Code, Claude, or the
installed OpenCode app.

## Kimi Bridge Is Separate

The local server retry screen is about the embedded OpenCode/OpenKimi sidecar.
The Kimi ACP bridge is a different loopback service, usually:

```text
http://127.0.0.1:8767
```

Bridge setup and smoke tests are documented in `KIMI_SETUP.md`.

If the bridge is down, model calls may fail later, but the desktop app should
still get past the `Local Server` health gate.

## Known Caveats For Future Agents

- Keep the sidecar auth username centralized. Do not hard-code a second value in
  the renderer initialization path.
- `OPENCODE_SERVER_USERNAME` and `OPENCODE_SERVER_PASSWORD` still exist because
  the embedded server comes from the OpenCode package.
- `SIDECAR_SERVICE_NAME` is still `opencode server`; changing service names is
  not required for this fix.
- The repo is a partially converted fork with many dirty files. Before making
  broader changes, inspect `git status --short --branch` and preserve unrelated
  work.
- The desktop build is currently a better verification target for this sidecar
  path than package typecheck, because typecheck is blocked by unrelated
  declaration-build state.
