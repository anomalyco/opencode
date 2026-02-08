# Agent Hooks Architecture

## Overview

The Agent Hooks system provides tab status indicators for CLI coding agents (Claude, Codex, Amp, Aider, Goose, Cline) running in Claxedo terminal tabs. When a user runs a CLI agent in a terminal, the tab displays:

- **Loading spinner**: Agent is actively working (processing a prompt)
- **Attention dot (red pulsing)**: Agent needs user input (permission request)
- **Done dot (green)**: Agent finished its last turn (idle after activity)

This document describes the complete architecture, from shell integration to UI updates.

---

## Table of Contents

1. [System Components](#system-components)
2. [Event Flow](#event-flow)
3. [File Structure](#file-structure)
4. [Shell Integration](#shell-integration)
5. [Wrapper Scripts](#wrapper-scripts)
6. [Backend Routes](#backend-routes)
7. [Frontend Listener](#frontend-listener)
8. [PTY Environment Injection](#pty-environment-injection)
9. [Upstream Pristine Principle](#upstream-pristine-principle)
10. [Supported Scenarios](#supported-scenarios)
11. [Limitations](#limitations)
12. [Testing](#testing)
    - [Local Development](#local-development)
    - [Manual Testing](#manual-testing)
    - [Debugging](#debugging)
13. [Future Improvements](#future-improvements)

---

## System Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLAXEDO DESKTOP/WEB                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐                   │
│  │  Terminal   │     │  Terminal   │     │   Session   │                   │
│  │    Tab 1    │     │    Tab 2    │     │    Tab 3    │                   │
│  │  (claude)   │     │  (codex)    │     │  (opencode) │                   │
│  │     🔄      │     │     🔴      │     │     💬      │                   │
│  └──────┬──────┘     └──────┬──────┘     └─────────────┘                   │
│         │                   │                                               │
│         └─────────┬─────────┘                                               │
│                   │                                                         │
│         ┌─────────▼─────────┐                                               │
│         │  Agent Lifecycle  │  ◄── SSE events from backend                 │
│         │     Listener      │                                               │
│         └───────────────────┘                                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ▲
                                      │ SSE (Server-Sent Events)
                                      │ event: agent.lifecycle
                                      │
┌─────────────────────────────────────┴───────────────────────────────────────┐
│                            OPENCODE SERVER                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────────┐     ┌───────────────────┐                           │
│  │  /hook/agent-     │     │    GlobalBus      │                           │
│  │    lifecycle      │────►│    .emit()        │──► SSE to all clients     │
│  │  (HTTP endpoint)  │     │                   │                           │
│  └─────────▲─────────┘     └───────────────────┘                           │
│            │                                                                │
│            │ HTTP GET (curl)                                                │
│            │                                                                │
└────────────┼────────────────────────────────────────────────────────────────┘
             │
┌────────────┼────────────────────────────────────────────────────────────────┐
│            │                    PTY TERMINAL                                │
├────────────┼────────────────────────────────────────────────────────────────┤
│            │                                                                │
│  ┌─────────┴─────────┐                                                      │
│  │   notify.sh       │  ◄── Called by CLI agent hooks                      │
│  │  ~/.claxedo/      │                                                      │
│  │  hooks/notify.sh  │                                                      │
│  └─────────▲─────────┘                                                      │
│            │                                                                │
│            │ Hook callback (stdin JSON or direct call)                      │
│            │                                                                │
│  ┌─────────┴─────────┐     ┌───────────────────┐                           │
│  │  Claude Wrapper   │     │   Codex Wrapper   │                           │
│  │  ~/.claxedo/      │     │   ~/.claxedo/     │                           │
│  │  bin/claude       │     │   bin/codex       │                           │
│  └─────────▲─────────┘     └─────────▲─────────┘                           │
│            │                         │                                      │
│            │ PATH lookup             │                                      │
│            │                         │                                      │
│  ┌─────────┴─────────────────────────┴─────────┐                           │
│  │              User's Shell                    │                           │
│  │  PATH=~/.claxedo/bin:$PATH                  │                           │
│  │                                              │                           │
│  │  Environment:                                │                           │
│  │    CLAXEDO_TAB_ID=pty_abc123                │                           │
│  │    CLAXEDO_TERMINAL_ID=pty_abc123           │                           │
│  │    CLAXEDO_WORKSPACE_ID=/path/to/project    │                           │
│  │    CLAXEDO_PORT=4096                        │                           │
│  │    ZDOTDIR=~/.claxedo/shell (for zsh)       │                           │
│  └──────────────────────────────────────────────┘                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Event Flow

### 1. Terminal Creation

```
User clicks "New Terminal"
         │
         ▼
┌─────────────────────────────────────┐
│ Frontend: TerminalProvider.create() │
│ Sets: CLAXEDO_PORT, CLAXEDO_TAB_ID  │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Backend: Pty.create()               │
│ Detects CLAXEDO_PORT is set         │
│ Calls getTerminalEnvVars()          │
│ Injects: ZDOTDIR, CLAXEDO_* vars    │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Shell starts with modified env      │
│ Sources ~/.claxedo/shell/.zshrc     │
│ PATH now includes ~/.claxedo/bin    │
└─────────────────────────────────────┘
```

### 2. Agent Lifecycle (Start)

```
User types: claude "help me fix this bug"
         │
         ▼
┌─────────────────────────────────────┐
│ Shell looks up 'claude' in PATH     │
│ Finds ~/.claxedo/bin/claude first   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Wrapper: ~/.claxedo/bin/claude      │
│ Injects --settings flag pointing to │
│ ~/.claxedo/hooks/claude-settings.json│
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Real claude binary runs with hooks  │
│ On UserPromptSubmit hook fires      │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Hook calls notify.sh with JSON:     │
│ {"hook_event_name":"UserPromptSubmit"}│
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ notify.sh parses event, maps to     │
│ "Start", curls /hook/agent-lifecycle│
│ with tabId, terminalId, eventType   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Backend receives HTTP request       │
│ Broadcasts via GlobalBus.emit()     │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Frontend receives SSE event         │
│ Finds tab by terminalId             │
│ Sets tab.loading = true             │
│ Tab shows spinner indicator         │
└─────────────────────────────────────┘
```

### 3. Agent Lifecycle (Permission Request)

```
Claude needs to run a bash command
         │
         ▼
┌─────────────────────────────────────┐
│ PermissionRequest hook fires        │
│ notify.sh receives event            │
│ Curls with eventType=PermissionRequest│
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Frontend receives SSE event         │
│ Sets tab.attention = true           │
│ Tab shows red pulsing dot           │
└─────────────────────────────────────┘
```

### 4. Agent Lifecycle (Stop)

```
Claude finishes or user interrupts
         │
         ▼
┌─────────────────────────────────────┐
│ Stop hook fires                     │
│ notify.sh curls with eventType=Stop │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Frontend receives SSE event         │
│ Sets tab.done = true                │
│ Tab shows no indicator              │
└─────────────────────────────────────┘
```

---

## File Structure

### Runtime Files (Created by setupAgentHooks)

```
~/.claxedo/
├── bin/                          # Wrapper scripts (added to PATH)
│   ├── claude                    # Claude wrapper (injects --settings)
│   ├── codex                     # Codex wrapper (injects -c notify=...)
│   ├── amp                       # Generic wrapper
│   ├── aider                     # Generic wrapper
│   ├── goose                     # Generic wrapper
│   └── cline                     # Generic wrapper
│
├── hooks/                        # Hook scripts and configs
│   ├── notify.sh                 # Notification script (called by hooks)
│   └── claude-settings.json      # Claude hooks configuration
│
└── shell/                        # Shell integration files
    ├── .zshrc                    # Zsh config (sources user's, adds PATH)
    ├── .zshenv                   # Zsh env (preserves ZDOTDIR)
    └── .bashrc                   # Bash config (sources user's, adds PATH)
```

### Source Files (In claxedo-app)

```
packages/claxedo-app/
├── src/
│   ├── agent-hooks/
│   │   └── listener.ts           # Frontend SSE listener
│   │
│   └── opencode-patches/         # Backend patches (applied at build time)
│       ├── agent-hooks/
│       │   └── index.ts          # Setup functions, env var generation
│       ├── server/
│       │   ├── server.ts         # Patched server (mounts routes, calls setup)
│       │   └── routes/
│       │       └── agent-hook.ts # HTTP endpoints for lifecycle events
│       └── pty/
│           └── index.ts          # Patched PTY (injects env vars)
│
├── scripts/
│   ├── build-opencode.ts         # Builds patched opencode binary
│   ├── opencode-dev.ts           # Runs patched opencode in dev mode
│   └── desktop-dev-local.ts      # Full desktop with patched opencode
│
└── .dev-docs/
    └── agent-hooks-architecture.md  # This document
```

### Claxedo Cloud Backend

```
claxedo/src/server/
├── routes/
│   ├── agent-hook.ts             # Agent lifecycle route (mirrors opencode patch)
│   └── index.ts                  # Exports AgentHookRoutes
└── app.ts                        # Mounts /hook route
```

---

## Shell Integration

### How Shell Integration Works

When a PTY is created with `CLAXEDO_PORT` set, the backend injects shell-specific environment variables:

#### Zsh (via ZDOTDIR)

```bash
# Environment set by PTY:
ZDOTDIR=~/.claxedo/shell
CLAXEDO_ORIG_ZDOTDIR=$HOME  # Preserves original ZDOTDIR

# ~/.claxedo/shell/.zshenv (sourced first):
if [ -z "${CLAXEDO_ORIG_ZDOTDIR:-}" ]; then
  export CLAXEDO_ORIG_ZDOTDIR="${ZDOTDIR:-$HOME}"
fi

# ~/.claxedo/shell/.zshrc (sourced for interactive):
_CLAXEDO_ORIG_ZDOTDIR="${CLAXEDO_ORIG_ZDOTDIR:-$HOME}"

# Source user's original configs
if [ -f "$_CLAXEDO_ORIG_ZDOTDIR/.zshenv" ]; then
  source "$_CLAXEDO_ORIG_ZDOTDIR/.zshenv"
fi
if [ -f "$_CLAXEDO_ORIG_ZDOTDIR/.zshrc" ]; then
  source "$_CLAXEDO_ORIG_ZDOTDIR/.zshrc"
fi

# Add our bin to PATH (takes precedence)
export PATH="~/.claxedo/bin:$PATH"
```

#### Bash (via BASH_ENV)

```bash
# Environment set by PTY:
BASH_ENV=~/.claxedo/shell/.bashrc

# ~/.claxedo/shell/.bashrc:
if [ -f "$HOME/.bashrc" ]; then
  source "$HOME/.bashrc"
fi

export PATH="~/.claxedo/bin:$PATH"
```

#### Other Shells (Fallback)

For shells without specific integration (fish, nushell, etc.), PATH is modified directly:

```bash
PATH=~/.claxedo/bin:$PATH
```

This may not work reliably as some shells don't inherit PATH modifications the same way.

---

## Wrapper Scripts

### Claude Wrapper

Claude Code supports native hooks via `--settings` flag:

```bash
#!/bin/bash
# ~/.claxedo/bin/claude

set -uo pipefail

# Find real claude binary (skip our wrapper directory)
find_real_binary() {
  local name="$1"
  local IFS=':'
  for dir in $PATH; do
    [ -z "$dir" ] && continue
    case "$dir" in
      "$HOME/.claxedo/bin") continue ;;
    esac
    if [ -x "$dir/$name" ] && [ ! -d "$dir/$name" ]; then
      printf "%s\n" "$dir/$name"
      return 0
    fi
  done
  return 1
}

REAL_CLAUDE="$(find_real_binary "claude")"

if [ -z "$REAL_CLAUDE" ]; then
  echo "Claxedo: claude not found in PATH." >&2
  exit 127
fi

# If user already specified --settings, don't override
for arg in "$@"; do
  case "$arg" in
    --settings|--settings=*)
      exec "$REAL_CLAUDE" "$@"
      ;;
  esac
done

# Inject our settings file with hooks
exec "$REAL_CLAUDE" --settings "~/.claxedo/hooks/claude-settings.json" "$@"
```

### Claude Settings (Hooks Configuration)

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "~/.claxedo/hooks/notify.sh" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "~/.claxedo/hooks/notify.sh" }] }
    ],
    "PermissionRequest": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "~/.claxedo/hooks/notify.sh" }] }
    ]
  }
}
```

### Codex Wrapper

Codex supports hooks via `-c` config flag:

```bash
#!/bin/bash
# ~/.claxedo/bin/codex

set -uo pipefail

# ... find_real_binary function ...

REAL_CODEX="$(find_real_binary "codex")"

if [ -z "$REAL_CODEX" ]; then
  echo "Claxedo: codex not found in PATH." >&2
  exit 127
fi

# Inject notify hook
exec "$REAL_CODEX" -c 'notify=["bash","~/.claxedo/hooks/notify.sh"]' "$@"
```

### Generic Wrapper (amp, aider, goose, cline)

For agents without native hook support, we wrap the entire execution:

```bash
#!/bin/bash
# ~/.claxedo/bin/amp (and others)

set -uo pipefail

# ... find_real_binary function ...

REAL_BIN="$(find_real_binary "amp")"

if [ -z "$REAL_BIN" ]; then
  echo "Claxedo: amp not found in PATH." >&2
  exit 127
fi

# Send Start event before running
if [ -n "${CLAXEDO_TAB_ID:-}" ]; then
  echo '{"hook_event_name":"Start"}' | "~/.claxedo/hooks/notify.sh" 2>/dev/null &
fi

# Run the real binary
"$REAL_BIN" "$@"
EXIT_CODE=$?

# Send Stop event after running
if [ -n "${CLAXEDO_TAB_ID:-}" ]; then
  echo '{"hook_event_name":"Stop"}' | "~/.claxedo/hooks/notify.sh" 2>/dev/null &
fi

exit $EXIT_CODE
```

**Limitation**: Generic wrappers can't detect permission requests (the agent would need native hook support).

### Notify Script

```bash
#!/bin/bash
# ~/.claxedo/hooks/notify.sh

# Exit silently if not in a Claxedo terminal
[ -z "$CLAXEDO_TAB_ID" ] && exit 0

# Read input (from stdin or first argument)
if [ -n "$1" ]; then
  INPUT="$1"
else
  INPUT=$(timeout 1 cat 2>/dev/null || echo "{}")
fi

EVENT_TYPE=""

# Parse Claude hook format: {"hook_event_name": "..."}
EVENT_TYPE=$(echo "$INPUT" | grep -oE '"hook_event_name"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -oE '"[^"]*"$' | tr -d '"' 2>/dev/null)

# Parse Codex format: {"type": "..."}
if [ -z "$EVENT_TYPE" ]; then
  CODEX_TYPE=$(echo "$INPUT" | grep -oE '"type"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -oE '"[^"]*"$' | tr -d '"' 2>/dev/null)
  case "$CODEX_TYPE" in
    "agent-turn-complete") EVENT_TYPE="Stop" ;;
    "agent-turn-start") EVENT_TYPE="Start" ;;
    "permission-request") EVENT_TYPE="PermissionRequest" ;;
  esac
fi

# Normalize Claude event names
case "$EVENT_TYPE" in
  "UserPromptSubmit") EVENT_TYPE="Start" ;;
esac

# Exit if no valid event
[ -z "$EVENT_TYPE" ] && exit 0

# Send to server (async, fire-and-forget)
(
  curl -sG "http://127.0.0.1:${CLAXEDO_PORT:-7860}/hook/agent-lifecycle" \
    --connect-timeout 1 \
    --max-time 2 \
    --data-urlencode "tabId=$CLAXEDO_TAB_ID" \
    --data-urlencode "terminalId=$CLAXEDO_TERMINAL_ID" \
    --data-urlencode "workspaceId=$CLAXEDO_WORKSPACE_ID" \
    --data-urlencode "eventType=$EVENT_TYPE" \
    > /dev/null 2>&1
) &

exit 0
```

---

## Backend Routes

### HTTP Endpoints

```
GET  /hook/agent-lifecycle    # Receive lifecycle events (from curl)
POST /hook/agent-lifecycle    # Receive lifecycle events (from API)
POST /hook/setup              # Initialize agent hooks infrastructure
GET  /hook/setup/status       # Check if setup is complete
GET  /hook/terminal-env       # Get environment variables for PTY
```

### Event Broadcasting

When a lifecycle event is received, it's broadcast to all connected clients:

```typescript
// In agent-hook.ts route handler
GlobalBus.emit("event", {
  directory: "global",  // Broadcast to all clients
  payload: {
    type: "agent.lifecycle",
    properties: {
      tabId,
      terminalId,
      workspaceId,
      eventType,  // "Start" | "Stop" | "PermissionRequest"
    },
  },
})
```

---

## Frontend Listener

### Event Subscription

```typescript
// In agent-hooks/listener.ts
export function createAgentLifecycleListener(
  updateTabStatus: (tabId: string, status: AgentStatus | undefined) => void,
  getTabs: () => Tab[]
) {
  // Subscribe to global events
  const unsubscribe = subscribeToGlobalEvents((event) => {
    if (event.type !== "agent.lifecycle") return

    const { tabId, terminalId, eventType } = event.properties

    // Find tab by ID or terminalId
    const tabs = getTabs()
    let tab = tabs.find((t) => t.id === tabId)
    if (!tab && terminalId) {
      tab = tabs.find((t) => t.type === "terminal" && t.terminalId === terminalId)
    }
    if (!tab) {
      tab = tabs.find((t) => t.type === "terminal" && t.terminalId === tabId)
    }

    if (!tab) return

    // Update tab status
    switch (eventType) {
      case "Start":
        updateTabStatus(tab.id, "loading")
        break
      case "Stop":
        updateTabStatus(tab.id, undefined)
        break
      case "PermissionRequest":
        updateTabStatus(tab.id, "attention")
        break
    }
  })

  return unsubscribe
}
```

### Tab Status Display

The tab component renders status indicators based on `tab.loading`, `tab.attention`, and `tab.done`:

```tsx
// In tab component
<Show when={tab.loading}>
  <LoadingIndicator />
</Show>
<Show when={tab.attention && !tab.loading}>
  <AttentionDot />
</Show>
<Show when={tab.done && !tab.loading && !tab.attention}>
  <DoneDot />
</Show>
```

---

## PTY Environment Injection

When a PTY is created, the backend checks for `CLAXEDO_PORT` and injects additional environment variables:

```typescript
// In pty/index.ts (patched)
export async function create(input: CreateInput) {
  const env = {
    ...process.env,
    ...input.env,
    TERM: "xterm-256color",
    OPENCODE_TERMINAL: "1",
  }

  // CLAXEDO PATCH: Inject agent hooks environment
  if (env.CLAXEDO_PORT && isSetupComplete()) {
    const tabId = env.CLAXEDO_TAB_ID || id
    const terminalId = env.CLAXEDO_TERMINAL_ID || id
    const workspaceId = env.CLAXEDO_WORKSPACE_ID || cwd
    const port = parseInt(env.CLAXEDO_PORT, 10) || 7860

    const agentEnv = getTerminalEnvVars({
      tabId,
      terminalId,
      workspaceId,
      port,
      shell: command,  // e.g., "/bin/zsh"
    })

    Object.assign(env, agentEnv)
  }

  // ... spawn PTY with env
}
```

### Environment Variables Generated

```typescript
function getTerminalEnvVars(params) {
  const env = {
    CLAXEDO_TAB_ID: params.tabId,
    CLAXEDO_TERMINAL_ID: params.terminalId,
    CLAXEDO_WORKSPACE_ID: params.workspaceId,
    CLAXEDO_PORT: String(params.port),
  }

  // Shell-specific integration
  const shellName = params.shell?.split("/").pop() || ""

  if (shellName === "zsh" || shellName.includes("zsh")) {
    env.ZDOTDIR = "~/.claxedo/shell"
    env.CLAXEDO_ORIG_ZDOTDIR = process.env.ZDOTDIR || process.env.HOME || ""
  } else if (shellName === "bash" || shellName.includes("bash")) {
    env.BASH_ENV = "~/.claxedo/shell/.bashrc"
  } else {
    // Fallback: directly modify PATH
    env.PATH = `~/.claxedo/bin:${process.env.PATH || ""}`
  }

  return env
}
```

---

## Upstream Pristine Principle

All backend modifications are implemented as **patches** that are applied at build time, keeping `packages/opencode` pristine.

### Patch System

```
packages/claxedo-app/src/opencode-patches/
├── agent-hooks/index.ts      → packages/opencode/src/agent-hooks/index.ts
├── server/server.ts          → packages/opencode/src/server/server.ts
├── server/routes/agent-hook.ts → packages/opencode/src/server/routes/agent-hook.ts
└── pty/index.ts              → packages/opencode/src/pty/index.ts
```

### Build Process

```bash
bun run opencode:build
```

1. Copy `packages/opencode` to temp directory
2. Overlay files from `src/opencode-patches/` into `temp/src/`
3. Run standard opencode build
4. Copy output to `dist-opencode/`

This mirrors the frontend override system (Vite aliases) but for the backend.

---

## Supported Scenarios

| Scenario | Support Level | Notes |
|----------|--------------|-------|
| Claude Code in terminal | ✅ Full | Native hooks via --settings |
| Codex in terminal | ✅ Full | Native hooks via -c notify=... |
| Amp in terminal | ⚠️ Partial | Start/Stop only, no permission detection |
| Aider in terminal | ⚠️ Partial | Start/Stop only |
| Goose in terminal | ⚠️ Partial | Start/Stop only |
| Cline in terminal | ⚠️ Partial | Start/Stop only |
| OpenCode session | ❌ N/A | Different system (session events) |
| zsh shell | ✅ Full | ZDOTDIR integration |
| bash shell | ✅ Full | BASH_ENV integration |
| fish shell | ⚠️ Limited | PATH fallback only |
| nushell | ⚠️ Limited | PATH fallback only |

---

## Limitations

### 1. Direct Binary Execution

If a user runs the binary directly (bypassing PATH):
```bash
/usr/local/bin/claude "hello"  # Bypasses wrapper
```
The wrapper won't intercept it and no hooks will fire.

### 2. Non-Standard Shells

Fish, nushell, and other shells may not properly inherit environment variables or source our integration files.

### 3. Generic Wrapper Limitations

Agents without native hook support (amp, aider, goose, cline) only get Start/Stop events. Permission requests cannot be detected.

### 4. SSH/Nested Shells

If the user SSHs into another machine or starts a nested shell that doesn't inherit our environment, hooks won't work.

### 5. First-Run Setup

The `setupAgentHooks()` function must be called before the first terminal is created. This happens automatically when the server starts.

### 6. Port Mismatch

If `CLAXEDO_PORT` doesn't match the actual server port, curl requests will fail silently.

---

## Testing

### Local Development

```bash
cd packages/claxedo-app

# Run desktop with patched opencode (recommended)
bun run desktop:dev:local

# Or run just the patched server
bun run opencode:dev --port 4096
```

### Manual Testing

1. Open the app and create a terminal tab
2. Check that `~/.claxedo/` directory exists with proper files
3. Verify environment in terminal:
   ```bash
   echo $CLAXEDO_TAB_ID
   echo $CLAXEDO_PORT
   echo $PATH | grep claxedo
   ```
4. Run `claude` and observe:
   - Tab should show spinner when agent starts
   - Tab should show attention dot on permission request
   - Tab should clear indicator when agent stops

### Debugging

The agent hooks system has comprehensive debug logging that can be enabled with environment variables.

#### Enable Debug Mode

**Backend (server/shell scripts):**

```bash
# Method 1: Pass --debug flag
bun run desktop:dev:local --debug
bun run opencode:dev --debug

# Method 2: Set environment variable
CLAXEDO_DEBUG=1 bun run desktop:dev:local
```

**Frontend (browser):**

```javascript
// Run in browser console, then reload
localStorage.setItem("claxedo.debug.agent-hooks", "1")
```

#### What Gets Logged

With `CLAXEDO_DEBUG=1`:

1. **Shell scripts** → `~/.claxedo/debug.log` (NOT terminal):
   - Wrapper script invocation with arguments
   - Real binary path resolution
   - Event type extraction from input
   - curl request/response to hook endpoint

2. **Backend routes** → server console:
   - Request received with all parameters
   - Validation failures
   - GlobalBus emission details

3. **PTY creation** → server console:
   - Agent hooks setup status
   - Environment variables being injected
   - Shell integration type (zsh/bash/fallback)

4. **Frontend listener** → browser console:
   - Event subscription setup
   - All events received on global channel
   - Tab lookup process (by tabId, terminalId)
   - Tab status updates (loading/attention changes)

#### Watching Shell Script Logs

Shell scripts write to a log file to avoid polluting the terminal:

```bash
# Watch debug logs in a separate terminal
tail -f ~/.claxedo/debug.log
```

#### Example Debug Output

**~/.claxedo/debug.log** (shell scripts):
```
14:32:01 [zsh] Loading .zshrc TAB_ID=pty_abc123
14:32:01 [zsh] PATH updated
14:32:05 [claude] wrapper called args:
14:32:05 [claude] Real binary: /usr/local/bin/claude
14:32:05 [claude] Injecting settings: /Users/.../.claxedo/hooks/claude-settings.json
14:32:06 [notify] notify.sh called with args:
14:32:06 [notify] Final EVENT_TYPE: Start
14:32:06 [notify] curl exit=0 response={"success":true}
```

**Server console** (backend):
```
[agent-hook:debug] GET /agent-lifecycle received { tabId: "pty_abc123", eventType: "Start" }
[agent-hook] lifecycle event: { tabId: "pty_abc123", eventType: "Start" }
[agent-hook:debug] Emitting to GlobalBus { directory: "global", payload: {...} }
```

**Browser console** (frontend):
```
[agent-hooks:debug] Received event from global channel { type: "agent.lifecycle" }
[agent-hooks:debug] Processing lifecycle event { tabId: "pty_abc123", eventType: "Start" }
[agent-hooks:debug] Found tab by tabId { tabId: "pty_abc123" }
[agent-hooks:debug] Setting loading=true, attention=false for tab pty_abc123
```

#### Manual Testing

Check if notify.sh is being called correctly:
```bash
# Basic test - output goes to ~/.claxedo/debug.log
CLAXEDO_DEBUG=1 CLAXEDO_TAB_ID=test123 CLAXEDO_PORT=4096 \
  echo '{"hook_event_name":"Start"}' | ~/.claxedo/hooks/notify.sh

# Check the log file
cat ~/.claxedo/debug.log

# Verify wrapper intercepts binary
which claude  # Should show ~/.claxedo/bin/claude
```

#### Common Debug Scenarios

**"Tab indicator not showing"**
1. Enable debug in frontend (`localStorage.setItem(...)`)
2. Run agent and check console for:
   - "tab not found" → terminalId mismatch
   - No event logged → backend not receiving hook
   - Event logged but wrong tabId → env var not set in PTY

**"Hook not firing"**
1. Enable `CLAXEDO_DEBUG=1` in backend
2. Check server logs for agent-hook requests
3. If no requests: check `echo $CLAXEDO_TAB_ID` in terminal
4. If empty: shell integration not loaded (check `echo $ZDOTDIR`)

**"Wrong binary being used"**
1. Run `which claude` (or other agent)
2. Should show `~/.claxedo/bin/claude`
3. If not: `echo $PATH` should have `~/.claxedo/bin` first

---

## Future Improvements

### 1. OpenCode Session Status

Add tab status for OpenCode's built-in session by listening to session events:
- `session.part.updated` → loading
- `message.created` (type: user) → loading
- `message.created` (type: assistant, complete) → clear

### 2. Fish/Nushell Integration

Add native integration files for additional shells:
- `~/.claxedo/shell/config.fish`
- `~/.claxedo/shell/config.nu`

### 3. Native Hook Support for More Agents

As agents add native hook support, update their wrappers to use it instead of generic wrapping.

### 4. Automatic Permission Detection

For generic wrappers, attempt to detect permission requests by monitoring stdout for common patterns (e.g., "Do you want to proceed?").

### 5. Agent Identification

Show which agent is running in the tab (e.g., "Claude" vs "Codex") by passing agent name in the hook callback.

---

## References

- [Claude Code Hooks Documentation](https://docs.anthropic.com/claude-code/hooks)
- [Codex Configuration](https://github.com/openai/codex)
- [Claxedo Architecture](../ARCHITECTURE.md)
