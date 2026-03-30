# Athena Browser Agent

## What Is This

This is **Athena Browser Agent** — an AI-powered browser automation agent. It was forked from [OpenCode](https://github.com/anomalyco/opencode) (open-source AI coding agent, 131k stars) and transformed into a browser automation platform.

## What Changed From OpenCode

- **Purpose**: Coding agent → Browser automation agent
- **Tools**: 8 code editing tools → 29 browser tools (click, type, snapshot, find, frame, cookies, network, etc.)
- **Browser**: None → Patchright (stealth) launches Chrome + agent-browser connects via CDP
- **Modes**: build/plan → auto (silent autonomous) + interactive (conversational)
- **Desktop App**: Code editor (file tree, diffs, terminal) → Browser live view panel
- **RAM**: Stripped LSP (15+ language servers), file watcher, formatters, git — saves 3-6GB
- **Branding**: OpenCode → Athena everywhere (prompts, TUI, terminal title, desktop app)
- **Theme**: Purple accents (#b48efa primary, #e07bff accent)

## Architecture

```
Tauri Desktop App (Athena Browser)
├── Left Panel: Agent chat (messages, tools, permissions, todos)
├── Right Panel: Browser live view (WebSocket viewport stream)
└── Sidecar: athena CLI binary (agent core)

Agent Core (TypeScript/Bun)
├── 29 browser tools (agent-browser primary + patchright fallback)
├── auto mode (silent, human_handoff for auth only)
├── interactive mode (conversational, asks user)
├── Patchright launches Chrome (stealth, persistent profile)
├── agent-browser connects via CDP (AI-optimized @ref snapshots)
└── Session management, LLM loop, 25+ providers

Browser
├── Google Chrome (real, not Chromium — max stealth)
├── Headed mode (user sees automation)
├── Persistent profile (~/.local/share/athena/browser-profile/)
└── Cookies/logins survive across sessions
```

## Key Files

```
src/browser/          — Browser automation core (daemon, client, patchright, API)
src/tool/browser/     — 29 browser tools for the LLM
src/agent/            — auto + interactive agent definitions
packages/desktop/     — Tauri v2 desktop app (forked from OpenCode)
packages/app/         — Shared UI (chat, settings, browser live view)
packages/ui/          — Design system
packages/sdk/         — HTTP SDK client
ARCHITECTURE.md       — Full technical documentation
```

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

## Per-Session MCPs & Skills (Planned)

Each session can load different MCP servers and skills:
- LinkedIn session → linkedin-mcp + outreach skills
- Shopping session → shopping-mcp + price comparison skills

See `ARCHITECTURE.md` for full details.
