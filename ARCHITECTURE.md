# Athena Browser Agent — Architecture

## Overview

Athena Browser Agent is an AI-powered browser automation agent that runs as a Tauri desktop app. It uses an LLM (via Vercel AI SDK) to execute browser tasks autonomously, with 28+ browser tools powered by **agent-browser** (primary) and **Patchright** (stealth fallback).

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ TAURI APP (Athena Agent)                                     │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Agent Core (TypeScript / Bun)                          │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐             │  │
│  │  │ LLM Loop │  │ Session  │  │ Tool     │             │  │
│  │  │ (AI SDK) │  │ Manager  │  │ Registry │             │  │
│  │  └────┬─────┘  └──────────┘  └────┬─────┘             │  │
│  │       │                           │                    │  │
│  │       │     ┌─────────────────────┴──────────┐         │  │
│  │       │     │ 28 Browser Tools               │         │  │
│  │       │     │ click, type, snapshot, find,    │         │  │
│  │       │     │ scroll, frame, dialog, wait...  │         │  │
│  │       │     └─────────────┬──────────────────┘         │  │
│  │       │                   │                            │  │
│  │  ┌────┴───────────────────┴────────────────────────┐   │  │
│  │  │ AthenaBrowser API (src/browser/api.ts)          │   │  │
│  │  │  .start() .exec() .execSafe() .shutdown()       │   │  │
│  │  └──────────┬───────────────────────┬──────────────┘   │  │
│  │             │                       │                  │  │
│  │  ┌──────────▼──────────┐  ┌─────────▼────────────┐    │  │
│  │  │ agent-browser       │  │ Patchright            │    │  │
│  │  │ (PRIMARY)           │  │ (FALLBACK + STEALTH)  │    │  │
│  │  │                     │  │                       │    │  │
│  │  │ • @ref snapshots    │  │ • CSS selectors       │    │  │
│  │  │ • 93% token savings │  │ • iframe/shadow DOM   │    │  │
│  │  │ • AI-optimized      │  │ • anti-bot bypass     │    │  │
│  │  │ • 108+ commands     │  │ • Runtime.enable fix  │    │  │
│  │  │ • Rust CLI → daemon │  │ • closed shadow roots │    │  │
│  │  └──────────┬──────────┘  └─────────┬─────────────┘    │  │
│  │             │       CDP             │                  │  │
│  │             └───────────┬───────────┘                  │  │
│  │                         ▼                              │  │
│  │              Chrome (Google Chrome)                    │  │
│  │              • Headed (user can see)                   │  │
│  │              • Persistent profile                     │  │
│  │              • Stealth flags                          │  │
│  │              • Launched by Patchright                 │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ TUI (Terminal UI)                                      │  │
│  │ • Purple Athena theme                                  │  │
│  │ • Browser tool icons (🌐👆⌨👁📸🔍...)                │  │
│  │ • Auto/Interactive mode indicator                     │  │
│  │ • Human handoff alert (⏸ PAUSED)                      │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## How It Works

### Browser Lifecycle

```
Session Start
  │
  ├─ Patchright.launchPersistentContext()
  │    • channel: "chrome" (real Chrome, not Chromium)
  │    • headless: false (user sees the browser)
  │    • viewport: null (real window, not detectable)
  │    • --remote-debugging-port=9222
  │    • persistent profile at ~/.local/share/athena/browser-profile/
  │
  ├─ agent-browser --cdp 9222 --session athena-xxx open about:blank
  │    • Connects to Chrome via CDP
  │    • Daemon starts and persists at ~/.agent-browser/athena-xxx.sock
  │    • All subsequent commands reuse daemon (sub-ms overhead)
  │
  └─ Ready for tool calls

Session End / Process Exit
  │
  ├─ agent-browser session released (navigate to about:blank)
  ├─ Patchright closes Chrome context
  ├─ Daemon socket cleaned up
  └─ killAllOrphans() as safety net (pkill/taskkill)
```

### Tool Execution Flow

```
LLM calls browser_click(@e3)
  │
  ├─ BrowserClient.exec("click", "@e3")
  │    │
  │    ├─ Attempt 1: agent-browser --cdp 9222 click @e3
  │    │   ├─ Success → return snapshot
  │    │   └─ Failure → retry (up to 3x with backoff)
  │    │
  │    └─ All retries failed?
  │         │
  │         └─ Auto-fallback to Patchright (via execWithFallback)
  │              └─ page.click(selector) → return snapshot
  │
  └─ Tool returns updated page snapshot to LLM
```

### Agent Modes

| Mode | Behavior | Talks to User? |
|------|----------|---------------|
| **auto** | Silent autonomous execution. Given task → make todo → execute → report. | ONLY via `browser_human_handoff` for auth/payment/captcha |
| **interactive** | Conversational. Shows state, asks what to do, guides user. | Yes, always |

### Human Handoff (Auth/Login/Payment)

```
Agent detects login form in snapshot
  │
  ├─ Captures current URL + page state
  ├─ Calls browser_human_handoff(reason: "login")
  ├─ TUI shows: ⏸ PAUSED — Human Action Required
  ├─ User logs in via headed Chrome window
  │
  ├─ Polls every 3s for page change (URL or content)
  │    • Max wait: 3 minutes (60 polls × 3s)
  │    • Detects: URL change OR snapshot content change
  │
  ├─ Page changed → resume automation
  └─ Page unchanged after 3min → report failure, do NOT retry
```

---

## Package Structure

```
src/
├── browser/                    # Browser automation core
│   ├── api.ts                  # AthenaBrowser — public API for Tauri
│   ├── binary.ts               # agent-browser binary resolution
│   ├── client.ts               # agent-browser CLI wrapper + retries + fallback
│   ├── daemon.ts               # Browser lifecycle (Patchright + agent-browser)
│   ├── patchright.ts           # Patchright launcher (stealth Chrome)
│   ├── state.ts                # Per-session browser state tracking
│   └── index.ts                # Barrel exports
│
├── tool/browser/               # 29 browser tools for the LLM
│   ├── open.ts                 # 🌐 Open URL
│   ├── navigate.ts             # 🔗 Navigate/back/forward/reload
│   ├── click.ts                # 👆 Click element (auto-screenshot on fail)
│   ├── type.ts                 # ⌨ Type/fill text
│   ├── select.ts               # ☰ Dropdown select
│   ├── press.ts                # ⌨ Keyboard keys
│   ├── hover.ts                # ◎ Hover element
│   ├── drag.ts                 # ✥ Drag and drop
│   ├── scroll.ts               # ↕ Scroll page
│   ├── upload.ts               # 📤 File upload
│   ├── snapshot.ts             # 👁 Page snapshot (auto-screenshot fallback)
│   ├── screenshot.ts           # 📸 Screenshot
│   ├── extract.ts              # 📋 Extract text/HTML/title/URL
│   ├── find.ts                 # 🔍 Semantic element search
│   ├── console.ts              # ▸ Browser console logs
│   ├── frame.ts                # ⬡ iframe switching
│   ├── dialog.ts               # 💬 Alert/confirm/prompt handling
│   ├── tab.ts                  # 📑 Tab management
│   ├── wait.ts                 # ⏳ Wait for elements/navigation
│   ├── cookies.ts              # 🍪 Cookie management
│   ├── storage.ts              # 💾 localStorage management
│   ├── network.ts              # 📡 Network interception/monitoring
│   ├── config.ts               # ⚙ Browser settings
│   ├── evaluate.ts             # ⚡ JavaScript execution
│   ├── close.ts                # ✕ Close (session-end only)
│   ├── human_handoff.ts        # ⏸ Auth/payment/captcha pause
│   ├── patchright_fallback.ts  # 🛡 Stealth Patchright fallback
│   └── index.ts                # Barrel exports
│
├── agent/                      # Agent definitions
│   ├── agent.ts                # auto + interactive agents
│   └── prompt/
│       ├── auto.txt            # Autonomous mode system prompt
│       └── interactive.txt     # Interactive mode system prompt
│
├── session/                    # Session management + LLM loop
├── provider/                   # 25+ LLM providers
├── config/                     # Configuration (browser.*, flags)
└── cli/cmd/tui/                # Terminal UI (purple Athena theme)
```

---

## Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `agent-browser` | Primary browser tools (Rust CLI + daemon) | ~10MB binary |
| `patchright` | Stealth Chrome launcher + fallback (Playwright fork) | ~5MB + Chrome |
| `ai` (Vercel AI SDK) | LLM integration, tool calling, streaming | npm |
| 25+ `@ai-sdk/*` | LLM providers (Anthropic, OpenAI, Google, etc.) | npm |

### Chrome

- **Launched by**: Patchright via `launchPersistentContext`
- **Channel**: `chrome` (real Google Chrome, not Chromium)
- **Install**: `npx patchright install chrome` (one-time)
- **Profile**: `~/.local/share/athena/browser-profile/` (persists logins)
- **Stealth**: No `Runtime.enable`, no automation flags, real viewport

---

## Why CLI Spawn (Not Direct Socket)

agent-browser uses a **client-daemon architecture**:

```
CLI (Rust, ~50ms startup) ──socket──▸ Daemon (persists) ──CDP──▸ Chrome
```

| Approach | Overhead | Status |
|----------|----------|--------|
| **CLI spawn (what we use)** | ~50ms first call, sub-ms after | Stable, recommended |
| Direct socket | ~0ms per call | Undocumented protocol, daemon crashes on connect (Bug #398) |
| Rust daemon (experimental) | ~0ms, no Node.js | Experimental, not production-ready |

**We use CLI spawn because:**
1. Daemon auto-starts on first command, persists via Unix socket
2. Subsequent commands reuse daemon — sub-millisecond overhead
3. For 50 commands/session: total overhead is ~50ms (negligible)
4. CLI is the only officially supported + stable interface
5. Direct socket has undocumented protocol + Windows TCP bug
6. CLI handles errors, sessions, cleanup automatically

---

## Production Reliability

### Retry Logic
- Every `exec()` call retries up to 3 times with exponential backoff (500ms, 1s, 1.5s)
- Non-retryable errors (invalid args, element not found) fail immediately
- After all retries: auto-fallback to Patchright for common operations

### Health Check
- `BrowserClient.healthCheck(sessionId)` — quick `get url` test (5s timeout)
- `BrowserClient.ensureReady(sessionId)` — check + auto-restart daemon if dead

### Process Cleanup
- `SIGINT`, `SIGTERM`, `SIGHUP`, `beforeExit`, `exit` all trigger cleanup
- Two layers: graceful `stopAll()` (5s timeout) + forceful `killAllOrphans()` (pkill)
- Guard prevents double-cleanup
- Profile directory preserved (logins survive)

### Screenshot Fallback
- `browser_snapshot` auto-attaches screenshot when page is sparse (canvas, loading)
- `browser_click` auto-screenshots on failure for stale @ref recovery

---

## Tauri Integration

```typescript
import { AthenaBrowser } from "./browser/api"

// In your Tauri app's init:
await AthenaBrowser.start("main-session", { headed: true })

// Execute commands:
const result = await AthenaBrowser.execSafe("main-session", ["open", "https://example.com"])

// Direct Patchright access:
await AthenaBrowser.patchright.click("button.submit")

// On app close:
await AthenaBrowser.shutdown()
```

### Configuration

**Environment variables:**
```bash
ATHENA_BROWSER_HEADED=true          # Show browser window (default: true)
ATHENA_BROWSER_TIMEOUT=30000        # Action timeout in ms
ATHENA_BROWSER_EXECUTABLE=/path     # Custom agent-browser binary
ATHENA_BROWSER_CDP_PORT=9222        # CDP port (default: 9222)
```

**Config file (`~/.config/athena/athena.jsonc`):**
```jsonc
{
  "browser": {
    "headed": true,
    "timeout": 30000,
    "viewport": { "width": 1280, "height": 800 },
    "cdpPort": 9222,
    "idleTimeout": 300000
  }
}
```

---

## Security

- **File access**: Browser agents restricted to `~/.local/share/athena/` (app data only)
- **Stealth**: Patchright bypasses bot detection (no `Runtime.enable` leak, no automation flags)
- **Credentials**: Never handled by agent — `browser_human_handoff` pauses for user
- **Permissions**: Tool-level permission system (allow/ask/deny per tool)
- **Profile encryption**: Stored locally, not transmitted
