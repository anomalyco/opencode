# Claude Code Context — Athena Browser Agent

## Project Overview

This is **Athena Browser Agent**, forked from [OpenCode](https://github.com/anomalyco/opencode) and converted from a coding agent into a browser automation agent.

## Origin

- Forked from OpenCode (anomalyco/opencode) — open-source AI coding agent
- Extracted core agent + CLI, rebranded as "Athena Agent"
- Transformed into browser automation with Patchright (stealth Playwright fork)
- Desktop app forked from OpenCode's Tauri app, code editor replaced with browser live view

## What's Different From OpenCode

### Added
- 28 browser tools: click, type, snapshot, screenshot, find, frame, dialog, cookies, storage, network, config, evaluate, wait, tab, scroll, hover, select, press, drag, upload, extract, console, human_handoff, patchright_fallback
- Patchright stealth Chrome launcher (bypasses bot detection)
- CDP-based browser viewport streaming directly from Patchright Chrome
- Auto/interactive agent modes (replaces build/plan)
- Browser live view in Tauri desktop app (CDP `Page.screencastFrame`)
- Human handoff tool for auth/login/captcha/payment
- Persistent browser profile (logins survive across sessions)
- Purple Athena theme throughout TUI and desktop
- Cross-platform CI/CD (GitHub Actions for macOS/Windows/Linux)
- Windows code signing script (PFX + EV support)

### Removed / Stubbed (RAM savings ~3-6GB)
- LSP (15+ language servers) → no-op stub
- File watcher (parcel-watcher) → no-op stub
- Code formatters (prettier, black, rustfmt) → no-op stub
- Ripgrep code search → no-op stub
- Git/VCS tracking → no-op stub
- File modification tracking → no-op stub
- Patch/diff parser → no-op stub
- Git worktrees → no-op stub
- IDE detection → deleted
- **Project concept removed** — no git-based project discovery, no project picker. All sessions share a single global project. The app works like a normal chat app: open → see sessions → start.

### Rebranded
- All "OpenCode" → "Athena" (prompts, TUI, terminal title, desktop app, env vars)
- `__OPENCODE__` → `__ATHENA__` in desktop app
- `OPENCODE_*` → `ATHENA_*` env vars
- `@opencode-ai/*` → `@athena/*` packages
- All system prompts replaced — no more "best coding agent on the planet"

## Repository Structure

```
/                           — Root (agent core, CLI, TUI)
├── src/
│   ├── browser/            — Browser automation (daemon, client, patchright, API)
│   ├── tool/browser/       — 28 browser tools
│   ├── agent/              — auto + interactive agent definitions
│   ├── session/            — Session management, LLM loop
│   ├── provider/           — 25+ LLM providers
│   ├── server/routes/      — API routes (session, project, browser, etc.)
│   ├── lsp/                — STUBBED (no-op)
│   ├── format/             — STUBBED (no-op)
│   ├── file/               — watcher/ripgrep/time STUBBED
│   └── cli/cmd/tui/        — Terminal UI (purple theme)
├── packages/
│   ├── desktop/            — Tauri v2 desktop app
│   ├── app/                — Shared UI (browser live view panel)
│   ├── ui/                 — Design system
│   ├── sdk/                — HTTP SDK client
│   └── util/               — Shared utilities
├── migration/              — SQLite migrations (Drizzle ORM)
├── script/                 — Build scripts, code signing
├── .github/workflows/      — CI/CD for cross-platform desktop builds
├── ARCHITECTURE.md         — Full technical documentation
├── AGENTS.md               — Agent overview
└── CLAUDE.md               — This file
```

## Important Context

- **No project concept**: The OpenCode "project = git directory" model has been removed. All sessions use a single global `ProjectID.global`. `Instance.boot()` skips git discovery entirely. `Session.list()` returns all sessions globally (no project_id filtering). The desktop app auto-opens the data directory and goes straight to sessions — like a normal chat app.

- **Stubs are intentional**: LSP, format, watcher, ripgrep, file/time, VCS, worktree are stubbed with no-op implementations. They export the same interfaces but do nothing. This avoids breaking 79+ import sites while eliminating 3-6GB of RAM from spawning language servers and file watchers.

- **Browser viewport display**: The desktop app connects directly to Chrome's CDP port (launched by Patchright) using `Page.screencastFrame` for live viewport streaming. No agent-browser middleman for display — direct CDP connection to Chrome. The `/browser/status` API endpoint exposes the CDP port.

- **Browser lifecycle**: Patchright launches Chrome → agent-browser connects via CDP for AI-optimized @ref snapshots → tools work through agent-browser CLI. On session end, Chrome closes. On process exit, `killAllOrphans()` ensures no orphaned Chrome.

- **Human handoff**: When auto mode detects login/captcha/payment, it calls `browser_human_handoff` which pauses and polls for page change (3s intervals, 3min max). Does NOT loop — one handoff per auth page.

- **System prompts**: ALL model-specific fallback prompts (anthropic.txt, gpt.txt, beast.txt, codex.txt, gemini.txt, trinity.txt, default.txt) are browser-agent prompts. No coding-agent language anywhere. The auto/interactive agent prompts in `src/agent/prompt/` are the primary prompts used.

- **Desktop app (Tauri v2)**: Builds for macOS (dmg), Windows (nsis), Linux (deb, rpm). Sidecar system bundles the athena CLI binary. 13 Tauri plugins. Auto-updater. Process group management. CI/CD via GitHub Actions.

- **Effect library**: We use `effect@4.0.0-beta.37`. Some newer Effect APIs (like `timeoutOrElse`) don't exist — use `Effect.timeout` + `Effect.catchAll` instead.

## Build & Run

```bash
# CLI/TUI mode
bun install && bun run dev

# Desktop app (dev mode with hot reload)
cd packages/desktop
bun run predev    # builds CLI sidecar for current platform
bun run tauri dev

# Build CLI for all platforms
bun run build

# Build desktop app
cd packages/desktop
bun run build        # frontend (vite)
bun run tauri build  # compile Rust + bundle installer
```

## Desktop Build Targets

| Platform | Format | Architecture |
|----------|--------|--------------|
| macOS    | `.dmg`, `.app` | ARM64 (Apple Silicon), x64 (Intel) |
| Windows  | NSIS `.exe`    | x64, ARM64 |
| Linux    | `.deb`, `.rpm` | x64, ARM64 |

## CI/CD

GitHub Actions workflow (`.github/workflows/desktop-build.yml`):
1. Builds CLI sidecar binaries for all platforms in parallel
2. Builds Tauri desktop app per platform with sidecar bundled
3. Creates draft GitHub release with all installers
4. Triggered by version tags (`v*`) or manual dispatch

Secrets needed:
- `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — updater signing
- `WINDOWS_SIGNING_CERT_BASE64` + `WINDOWS_SIGNING_CERT_PASSWORD` — Windows code signing (optional)

## Key Environment Variables

```
ATHENA_BROWSER_HEADED=true        — Show browser window (default: true)
ATHENA_BROWSER_TIMEOUT=30000      — Action timeout in ms
ATHENA_BROWSER_CDP_PORT=9222      — CDP port
ATHENA_BROWSER_EXECUTABLE=/path   — Custom agent-browser binary
ATHENA_CLIENT=desktop             — Set by Tauri app
```

## Database

SQLite via Drizzle ORM. Migrations in `migration/` directory. Key migration: `20260331000000_global_project` consolidates all sessions/permissions/workspaces under the global project.

## Prompt Architecture

```
LLM system prompt = agent.prompt ?? model-specific fallback

Auto agent    → src/agent/prompt/auto.txt       (autonomous browser automation)
Interactive   → src/agent/prompt/interactive.txt (conversational browser assistant)
Fallback      → src/session/prompt/*.txt         (all are browser-agent prompts now)
```

All 7 model-specific fallback prompts (anthropic, gpt, beast, codex, gemini, trinity, default) contain identical browser-agent instructions. The agent generation prompt (`src/agent/generate.txt`) creates browser automation agents.
