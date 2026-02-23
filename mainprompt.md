# Mission: Port opencode to Android/Termux (Native Support)

You are helping add proper Termux/Android support to **opencode** — an open-source AI coding agent.

## What opencode actually is (read this carefully)
- **Bun/TypeScript monorepo** with ~18 packages managed via Bun workspaces + Turborepo
- **Core stack**: `packages/opencode/` — the main CLI, HTTP server (Hono), TUI, session management, LSP, file watcher, tools engine
- **TUI**: Built on `@opentui/solid` — which is **SolidJS + a native Zig binary** (`@opentui/core`). This is the #1 Termux blocker.
- **SQLite**: Used for session storage (`~/.local/share/opencode/opencode.db`). Added in v1.2.0+.
- **Binary distribution**: Shipped as platform-specific native binaries (not JS bundles). The `linux-arm64` binary currently uses `/lib/ld-linux-aarch64.so.1` as its ELF interpreter and is **not compiled as PIE** — both of which are incompatible with native Termux/Android.
- **Architecture**: Client-server. The server (HTTP + SSE) runs locally and TUI/SDK clients connect to it.

## Known Issues from the GitHub tracker (already reported)
- **Issue #10504**: The official linux-arm64 binary fails on Termux — wrong ELF interpreter (`/lib/ld-linux-aarch64.so.1` doesn't exist on Android), and the binary is not PIE (required on Android 5.0+)
- **Issue #10550**: Black screen on second launch in Termux — confirmed `opentui` rendering bug
- **Issue #9223**: First launch works in proot-Debian on Termux, second fails — server/process lifecycle issue
- **Issue #961**: General Termux support request (open since July 2025)
- **Issue #709**: YOLO install script paths are incompatible with Termux

## Your Goal
Make opencode work natively in Termux — no proot, no Debian layer — just Termux's native ARM64 Linux environment.

There are **two distinct work tracks** here. Understand the difference:

### Track A — Binary Build Fix (The Core Problem)
The distributed binary must be built correctly for Android/Termux:
- Must use the correct ELF interpreter for Termux: `/system/bin/linker64` (not `/lib/ld-linux-aarch64.so.1`)
- Must be compiled as PIE (Position-Independent Executable)
- The Zig-based `@opentui/core` native module is compiled as part of the binary. This Zig code **must be cross-compiled targeting the Android linker and ABI**, not standard glibc Linux

### Track B — Runtime/Installer Fixes
Even once the binary is correctly built, Termux paths and behaviors differ from standard Linux:

**Path differences:**
- `$HOME` = `/data/data/com.termux/files/home`
- Binaries live at `/data/data/com.termux/files/usr/bin/` (not `/usr/bin`)
- No `/lib/`, `/lib64/`, `/etc/` in the standard sense
- SSL certs: `/data/data/com.termux/files/usr/etc/tls/cert.pem`

**Behavior differences:**
- `uname -o` returns `Android`, not `GNU/Linux`
- No systemd, no `/proc/1/exe` tricks
- Shell: usually bash or zsh at Termux paths — detect via `$SHELL` or `which bash`

## Phase 1 — Deep Audit (Start Here)

Before touching any code, do a thorough read of the relevant source files:

1. **Read the build pipeline**:
   - `packages/opencode/package.json` — look at `scripts`, especially how the binary is built and bundled
   - `.github/workflows/publish.yml` (or similar) — understand how CI builds and packages the binary
   - Any `build.ts` or `scripts/` files that handle compilation

2. **Find the opentui Zig compilation**:
   - `packages/opencode/` uses `@opentui/solid` and `@opentui/core`
   - Find where the Zig native binary (`binding.node` or similar) is compiled and bundled
   - This is the hardest part of the port — Zig must be cross-compiled for Android ABI

3. **Audit the install script** (`install` file at repo root):
   - Find hardcoded paths (`/usr/local/bin`, etc.)
   - Find ELF interpreter or linker assumptions
   - Find `uname` or OS detection logic

4. **Audit the server/process lifecycle** (`packages/opencode/src/server/index.ts`):
   - How does the server check if another instance is running?
   - How does it handle PID files or lock files?
   - This is likely the cause of the "second launch fails" bug (issue #9223 / #10550)

5. **Audit the file watcher** (`packages/opencode/src/file/watcher.ts`):
   - It auto-detects libc type (glibc vs musl) — on Termux it uses a custom Bionic libc
   - Find lines 20 and 37-38 specifically — add Android/Termux detection there

6. **Audit path handling throughout `packages/opencode/src/`**:
   - Run: `grep -r "\/lib\/\|\/usr\/bin\|\/bin\/bash\|\/tmp\|getenv\|HOME\|XDG" packages/opencode/src/ --include="*.ts" -n`
   - Pay special attention to config paths, data dir, cache dir, temp dir

7. **Check SQLite setup**:
   - Find where the SQLite DB is initialized in `packages/opencode/src/session/index.ts`
   - Confirm whether it uses a bundled SQLite or system SQLite — and whether the bundled version will work on Android's Bionic libc

After completing the audit, give me a structured report:
- List every file with Termux-incompatible code, with the specific line numbers
- List the build system changes needed for PIE + correct ELF interpreter
- Rate the Zig/opentui cross-compilation as: Easy / Hard / Requires-Upstream-Changes
- Propose a prioritized fix order

## Phase 2 — Install Script Fix

Edit the `install` script at the repo root to support Termux:
```bash
# Detect Termux
is_termux() {
  [ -n "$TERMUX_VERSION" ] || [ -d "/data/data/com.termux" ]
}

# Use correct install dir on Termux
if is_termux; then
  INSTALL_DIR="${OPENCODE_INSTALL_DIR:-$HOME/.local/bin}"
  # Ensure SSL cert path is set for HTTPS calls
  export SSL_CERT_FILE="${SSL_CERT_FILE:-/data/data/com.termux/files/usr/etc/tls/cert.pem}"
fi
```

The install script should also:
- Detect Termux and skip trying to download the standard linux-arm64 binary (which won't work) — instead download a new `linux-android-arm64` binary once we build one
- Print a clear, helpful error if running on Termux before the Android binary is available
- Not hardcode paths that assume standard glibc Linux

## Phase 3 — File Watcher Fix

In `packages/opencode/src/file/watcher.ts`, the code auto-detects libc type. Add Termux/Android handling:
```typescript
function detectLibcType(): "glibc" | "musl" | "android" {
  // Termux/Android detection
  if (process.env.TERMUX_VERSION || existsSync("/data/data/com.termux")) {
    return "android"
  }
  // ... existing glibc/musl detection
}
```

Then handle the `"android"` case wherever libc type is used — likely by using the musl-compatible watcher fallback, or disabling the native file watcher and falling back to a polling-based approach (configure via `config.watch` if that option exists).

## Phase 4 — Server/Process Lifecycle Fix (Black Screen Bug)

Investigate and fix why the second launch fails (issues #9223 and #10550).

Likely causes:
- A stale PID/lock file from the previous run that isn't cleaned up when the process is killed
- A port that stays bound after the Termux process is killed (Android may not release it as quickly)
- The opentui rendering engine having state that isn't reset on second init

Steps:
1. Find where the server writes its PID or lock file
2. Add a startup check: if a lock file exists but the PID is dead, remove the lock file and continue
3. Find where opentui is initialized in the TUI code — check if there's a teardown/cleanup path that's not being called on Termux (SIGKILL vs SIGTERM behavior)
4. Add a `--force` or `--reset` CLI flag that cleans up stale server state

## Phase 5 — Build System Changes for Android/Termux Binary

This is the hardest phase. The goal is to produce a `opencode-linux-android-arm64` binary that works natively in Termux.

**For the Zig/opentui native module:**
- The `@opentui/core` package contains Zig source code compiled to a native binary
- To target Termux/Android, it must be compiled with Zig's cross-compilation for `aarch64-linux-android` target
- Zig natively supports Android cross-compilation: `zig build -Dtarget=aarch64-linux-android`
- The resulting binary must link against Bionic (Android's libc), not glibc
- You may need to set `android_version` and provide the Android NDK sysroot path to Zig

**For the Bun binary bundling:**
- Research how opencode currently bundles everything into a single binary (likely `bun build --compile` or similar)
- The `--compile` flag in Bun creates a single-file executable. Check if Bun supports Android cross-compilation for its own runtime
- If Bun doesn't support `linux-android-arm64` as a compile target, an alternative approach is: ship a `bun` binary for Termux separately and have the installer use it to run opencode from source, rather than using a pre-compiled all-in-one binary

**Alternative approach (easier, viable now):**
Instead of a full binary, create a **Termux-specific install path** that:
1. Downloads and installs Bun for Termux (`bun` has official arm64 Linux builds that work in Termux via proot but native support is limited — check current status)
2. Downloads the opencode source (or `opencode-ai` npm package) 
3. Runs via `bun run packages/opencode/src/index.ts` directly
4. Wraps this in a shell script called `opencode` placed in `$HOME/.local/bin/`

This avoids the PIE/ELF interpreter issue entirely since you're not running a pre-compiled binary — you're running TypeScript via Bun.

Evaluate both approaches and recommend which is more practical given current Bun + Zig toolchain capabilities.

## Phase 6 — Documentation

Create `TERMUX.md` at the repo root with:

### Prerequisites
```bash
pkg update -y
pkg install -y git nodejs bun  # or whatever the correct install method ends up being
```

### Installation
(The actual working steps you've validated)

### Known Limitations on Termux
- List any features that don't work (LSP servers may not be available, file watcher may use polling fallback, etc.)
- Note that the desktop app is not available

### Configuration
- Where config file lives: `~/.config/opencode/opencode.json`
- How to set API keys via env vars

### Troubleshooting
- Black screen on launch: run `rm -f ~/.local/share/opencode/*.lock` then retry
- SSL errors: `export SSL_CERT_FILE=/data/data/com.termux/files/usr/etc/tls/cert.pem`
- "cannot execute" error: you have the wrong binary type — see Installation

## Constraints
- **Never break existing platforms**: Linux, macOS, Windows must keep working exactly as before. Use runtime detection for all Termux-specific branches.
- **Detect Termux reliably**: `process.env.TERMUX_VERSION !== undefined` is the most reliable check. Second option: check if `/data/data/com.termux` exists.
- **Minimal, surgical changes**: Don't refactor working code. Touch only what's needed.
- **Upstream-friendly**: Write code that could be submitted as a PR to the main repo. Follow the existing TypeScript code style (no semicolons, 120 char line width per the prettier config).
- **Reference the open issues**: When you make a fix, note which GitHub issue it resolves (e.g., "Fixes #10504", "Partially fixes #10550").

## Start Here

Run the Phase 1 audit first. Read the actual source files — don't guess. Then report back findings before writing any fix code.