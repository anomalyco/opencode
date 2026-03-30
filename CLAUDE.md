# Claude Code Context — Athena Browser Agent

## Project Overview

This is **Athena Browser Agent**, forked from [OpenCode](https://github.com/anomalyco/opencode) and converted from a coding agent into a browser automation agent.

## Origin

- Forked from OpenCode (anomalyco/opencode) — open-source AI coding agent
- Extracted core agent + CLI, rebranded as "Athena Agent"
- Transformed into browser automation with Vercel's agent-browser + Patchright (stealth Playwright fork)
- Desktop app forked from OpenCode's Tauri app, code editor replaced with browser live view

## What's Different From OpenCode

### Added
- 29 browser tools: click, type, snapshot, screenshot, find, frame, dialog, cookies, storage, network, config, evaluate, wait, tab, scroll, hover, select, press, drag, upload, extract, console, human_handoff, patchright_fallback
- Patchright stealth Chrome launcher (bypasses bot detection)
- agent-browser integration via CDP (AI-optimized @ref snapshots)
- Auto/interactive agent modes (replaces build/plan)
- Browser live view in Tauri desktop app
- Human handoff tool for auth/login/captcha/payment
- Persistent browser profile (logins survive across sessions)
- Purple Athena theme throughout TUI and desktop

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

### Rebranded
- All "OpenCode" → "Athena" (prompts, TUI, terminal title, desktop app, env vars)
- `__OPENCODE__` → `__ATHENA__` in desktop app
- `OPENCODE_*` → `ATHENA_*` env vars
- `@opencode-ai/*` → `@athena/*` packages

## Repository Structure

```
/                           — Root (agent core, CLI, TUI)
├── src/
│   ├── browser/            — Browser automation (daemon, client, patchright, API)
│   ├── tool/browser/       — 29 browser tools
│   ├── agent/              — auto + interactive agent definitions
│   ├── session/            — Session management, LLM loop
│   ├── provider/           — 25+ LLM providers
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
├── ARCHITECTURE.md         — Full technical documentation
├── AGENTS.md               — Agent overview
└── CLAUDE.md               — This file
```

## Important Context

- **Stubs are intentional**: LSP, format, watcher, ripgrep, file/time, VCS, worktree are stubbed with no-op implementations. They export the same interfaces but do nothing. This is to avoid breaking 79+ import sites while eliminating 3-6GB of RAM usage from spawning language servers and file watchers.

- **Browser lifecycle**: Patchright launches Chrome → agent-browser connects via CDP → tools work through agent-browser CLI (daemon persists, sub-ms per command after first). On session end, Chrome closes. On process exit, `killAllOrphans()` ensures no orphaned Chrome.

- **Human handoff**: When auto mode detects login/captcha/payment, it calls `browser_human_handoff` which pauses and polls for page change (3s intervals, 3min max). Does NOT loop — one handoff per auth page.

- **Desktop app**: Forked from OpenCode's Tauri app. Code editor panels replaced with `BrowserLivePanel` (WebSocket viewport stream from agent-browser). Session side panel and terminal panel removed.

- **Effect library**: We use `effect@4.0.0-beta.37`. Some newer Effect APIs (like `timeoutOrElse`) don't exist — use `Effect.timeout` + `Effect.catchAll` instead.

## Build & Run

```bash
# CLI/TUI mode
bun install && bun run dev

# Desktop app
cd packages/desktop
bun run tauri dev

# Build for all platforms
bun run build
```

## Key Environment Variables

```
ATHENA_BROWSER_HEADED=true        — Show browser window (default: true)
ATHENA_BROWSER_TIMEOUT=30000      — Action timeout in ms
ATHENA_BROWSER_CDP_PORT=9222      — CDP port
ATHENA_BROWSER_EXECUTABLE=/path   — Custom agent-browser binary
ATHENA_CLIENT=desktop             — Set by Tauri app
```
