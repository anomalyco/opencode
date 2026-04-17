# Running the OpenCode Desktop App for Local Development

OpenCode ships two desktop builds — pick one. **The Tauri build is primary**; Electron is secondary. Both packages are under `opencode/packages/`.

## Prereqs (one-time)

```bash
# From opencode/ root
bun install
```

For **Tauri** additionally (required; the Electron build does not need Rust):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Plus Tauri OS dependencies — see https://v2.tauri.app/start/prerequisites/
# macOS: Xcode CLI tools
# Linux: webkit2gtk, libayatana-appindicator3, librsvg2, ...
# Windows: WebView2 runtime + MSVC build tools
```

---

## Option 1 — Tauri (recommended)

Standard dev command (from `opencode/` root):

```bash
bun run --cwd packages/desktop tauri dev
```

What happens:

1. Tauri runs its `beforeDevCommand` (`bun run dev` → Vite on `http://localhost:1420`, `strictPort`, watch excludes `src-tauri/**`).
2. The package's `predev` script first executes `packages/desktop/scripts/predev.ts`, which **builds the opencode CLI binary** via `cd ../opencode && bun run build --single` (or `--single --baseline`) and copies it into `src-tauri/sidecars/` as the bundled sidecar.
3. Rust compiles (`cargo`) — first run is slow (5–10 min), subsequent are fast.
4. A native window opens pointing at `localhost:1420` with the SolidJS UI; the Rust shell spawns that freshly built `opencode` binary as the sidecar, picks a free port, generates a UUID password, and exposes credentials through `commands.awaitInitialization`.

Other scripts (from `packages/desktop`):

```bash
bun run dev           # Vite only, no native window (UI-only iteration)
bun run typecheck     # tsgo -b
bun run tauri build   # production bundle (dmg/app/deb/rpm/nsis)
```

And Rust-only:

```bash
cd packages/desktop/src-tauri
cargo check           # quick Rust typecheck
cargo test            # run the 27 Rust unit tests
```

Environment knobs:

- `OPENCODE_PORT=…` — pin the sidecar port instead of auto-selecting
- `TAURI_DEV_HOST=…` — enable LAN / mobile-preview HMR (Vite binds that host; HMR switches to `ws://<host>:1421`)
- `OPENCODE_CHANNEL=dev|beta|prod` — controls app id/icons (dev is default)
- Iteration tip: after changing anything in `src/bindings.ts` consumers, rebuild Rust so `tauri-specta` regenerates bindings; the `test_export_types` Rust test flags drift if CI sees a mismatch.

---

## Option 2 — Electron

```bash
bun run --cwd packages/desktop-electron dev
```

What happens:

1. The `predev` script runs `packages/desktop-electron/scripts/predev.ts`, which copies channel icons (`copy-icons.ts <channel>`, default `dev`) and then `cd ../opencode && bun script/build-node.ts` — **builds the Node bundle of the opencode server** into `packages/opencode/dist/node/`. This is what Electron embeds in-process via the Vite virtual module `virtual:opencode-server`.
2. `electron-vite dev` builds three targets (`main` / `preload` / `renderer`) and launches Electron. The main process starts the server **in-process** (not as a subprocess), then opens the main window.

Channel-specific run (affects app id, name, userData path):

```bash
OPENCODE_CHANNEL=beta bun run --cwd packages/desktop-electron dev
OPENCODE_CHANNEL=prod bun run --cwd packages/desktop-electron dev
```

Other scripts (from `packages/desktop-electron`):

```bash
bun run typecheck              # tsgo -b across main/preload/renderer
bun run build                  # electron-vite build
bun run package                # electron-builder for current platform
bun run package:mac|win|linux  # target-specific bundle
```

Unit tests (only two files exist):

```bash
cd packages/desktop-electron
bun test src/main/shell-env.test.ts
bun test src/renderer/html.test.ts
```

---

## UI-only iteration (fastest loop)

If you only want to change SolidJS UI and not touch native shell code, skip the desktop runner entirely and use the web dev flow that `packages/app/AGENTS.md` documents:

```bash
# Terminal 1 — backend
cd opencode/packages/opencode
bun run --conditions=browser ./src/index.ts serve --port 4096

# Terminal 2 — UI
cd opencode/packages/app
bun dev -- --port 4444
# Open http://localhost:4444
```

This runs the exact same `@opencode-ai/app` code that both shells render, with far faster rebuilds and no Rust/Electron overhead.

---

## First-run gotchas

- **Rust not found** (Tauri): install via `rustup`.
- **Sidecar binary missing** (Tauri): the `predev` step failed to build the opencode CLI. Run `cd opencode/packages/opencode && bun run build --single` manually and check errors.
- **`virtual:opencode-server` not found** (Electron): the `prebuild`/`predev` Node build didn't complete. Run `cd opencode/packages/opencode && bun script/build-node.ts`.
- **Stale sidecar process**: both shells kill their sidecar on quit, but if dev was hard-killed, a zombie `opencode` may hold the port. Find and kill it (`pgrep -fl opencode` / `taskkill` on Windows) or pick a different port via `OPENCODE_PORT`.
- **Sqlite first-time migration**: on a fresh machine the first launch performs a one-time JSON→SQLite migration against `~/.local/share/opencode/opencode.db` (or `$XDG_DATA_HOME`). If it takes >1 s, a loading overlay appears. This only happens once.
- **Ports already in use**: default Vite dev port is `1420` (Tauri) with `strictPort: true`. Close whatever else is bound, or (for Tauri) it will hard-fail rather than fall back.
- **Corporate proxy eating loopback**: both shells auto-add loopback to `NO_PROXY` / `proxy-bypass-list`, but if your global proxy config is unusual and you see "sidecar unreachable", explicitly `export NO_PROXY=127.0.0.1,localhost,::1`.

Per `AGENTS.md`: never restart the app/server process yourself during a running session — let the dev runners own lifecycle.
