# Athena Browser Agent

## What Is This

This is **Athena Browser Agent** — an AI-powered browser automation agent. It was forked from [OpenCode](https://github.com/anomalyco/opencode) (open-source AI coding agent) and transformed into a browser automation platform.

## What Changed From OpenCode

- **Purpose**: Coding agent → Browser automation agent
- **Tools**: 8 code editing tools → 28 browser tools (click, type, snapshot, find, frame, cookies, network, etc.)
- **Browser**: None → Patchright (stealth) launches Chrome, viewport streamed via CDP screencast
- **Modes**: build/plan → auto (silent autonomous) + interactive (conversational)
- **Desktop App**: Code editor (file tree, diffs, terminal) → Browser live view panel (CDP direct)
- **Projects**: Git-based project discovery removed → single global project, flat session list
- **Prompts**: All "best coding agent" prompts → browser automation prompts
- **RAM**: Stripped LSP (15+ language servers), file watcher, formatters, git — saves 3-6GB
- **Branding**: OpenCode → Athena everywhere (prompts, TUI, terminal title, desktop app)
- **Theme**: Purple accents (#b48efa primary, #e07bff accent)
- **CI/CD**: GitHub Actions for cross-platform desktop builds (macOS/Windows/Linux)

## Architecture

```
Tauri Desktop App (Athena Browser)
├── Left Panel: Agent chat (messages, tools, permissions, todos)
├── Right Panel: Browser live view (CDP Page.screencastFrame from Patchright Chrome)
└── Sidecar: athena CLI binary (agent core)

Agent Core (TypeScript/Bun)
├── 28 browser tools (agent-browser primary + patchright fallback)
├── auto mode (silent, human_handoff for auth only)
├── interactive mode (conversational, asks user)
├── Patchright launches Chrome (stealth, persistent profile, CDP port 9222)
├── agent-browser connects via CDP (AI-optimized @ref snapshots)
├── Global project (no git discovery, sessions are flat like a chat app)
├── All system prompts are browser-agent focused (no coding remnants)
└── Session management, LLM loop, 25+ providers

Browser Display
├── Desktop app connects to Chrome CDP port (9222) directly
├── Uses Page.screencastFrame for live JPEG frame streaming
├── No agent-browser middleman for viewport display
├── URL tracked via Page.frameNavigated events
└── Auto-reconnects on disconnect

Browser Runtime
├── Google Chrome (real, not Chromium — max stealth)
├── Headed mode (user sees automation)
├── Persistent profile (~/.local/share/athena/browser-profile/)
└── Cookies/logins survive across sessions
```

## Session Model

No project picker, no directory selection. The app works like a normal chat app:
- Open Athena → see recent sessions → start a new one
- All sessions stored under a single global project
- No git-based project discovery or filtering
- Database migration consolidates everything to `ProjectID.global`

## Prompt Architecture

All system prompts are browser-agent focused:
- `src/agent/prompt/auto.txt` — Autonomous browser automation (primary)
- `src/agent/prompt/interactive.txt` — Conversational browser assistant (primary)
- `src/session/prompt/*.txt` — 7 model-specific fallbacks (all browser-agent, identical content)
- `src/agent/generate.txt` — Creates new browser automation agents

## Key Files

```
src/browser/              — Browser automation core (daemon, client, patchright, API)
src/browser/patchright.ts — Stealth Chrome launcher, CDP port management
src/browser/daemon.ts     — Browser lifecycle (Patchright + agent-browser)
src/tool/browser/         — 28 browser tools for the LLM
src/agent/                — auto + interactive agent definitions
src/agent/prompt/         — Browser-specific agent prompts
src/session/prompt/       — Model-specific fallback prompts (all browser-agent)
src/project/instance.ts   — Global project (no git discovery)
src/server/routes/browser.ts — CDP port API for desktop app
packages/desktop/         — Tauri v2 desktop app
packages/app/             — Shared UI (chat, settings, browser live view)
packages/app/src/pages/session/browser-live-panel.tsx — CDP screencast viewer
.github/workflows/        — CI/CD for cross-platform builds
script/sign-windows.ps1   — Windows code signing (PFX + EV)
migration/                — SQLite migrations (Drizzle ORM)
```

## Desktop Build

Tauri v2 desktop app builds for all platforms:

| Platform | Format | Architecture |
|----------|--------|--------------|
| macOS    | `.dmg`, `.app` | ARM64, x64 |
| Windows  | NSIS `.exe`    | x64, ARM64 |
| Linux    | `.deb`, `.rpm` | x64, ARM64 |

CI/CD via GitHub Actions (`.github/workflows/desktop-build.yml`):
1. Builds CLI sidecar for all platforms
2. Builds Tauri desktop app with sidecar bundled
3. Creates GitHub release with installers

## Setup

```bash
bun install                              # Install deps + auto-install Chrome
bun run dev                              # Run CLI/TUI mode
cd packages/desktop && bun run tauri dev # Run desktop app
```

## How It Works

1. User gives a task ("go to linkedin and send connection requests")
2. Agent creates a todo list, opens browser, executes steps
3. If login/captcha/payment appears → pauses for human via `browser_human_handoff`
4. Human completes auth in headed Chrome → agent resumes
5. Agent completes task, reports results
6. Desktop app shows live browser viewport via CDP screencast

## Per-Session MCPs & Skills (Planned)

Each session can load different MCP servers and skills:
- LinkedIn session → linkedin-mcp + outreach skills
- Shopping session → shopping-mcp + price comparison skills

See `ARCHITECTURE.md` for full details.
