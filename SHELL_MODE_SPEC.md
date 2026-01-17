# Shell/Agent Execution Mode Feature Specification

the shell/agent/auto  mode is completely independent from the build, plan, etc. mode.

## Overview

This feature adds intelligent input routing between direct shell execution and AI agent processing. Users can work in three modes:

- **Shell Mode**: All input is executed directly in the shell
- **Agent Mode**: All input is processed by the AI agent
- **Auto Mode**: Input is routed based on command existence check (default)

Additionally, the shell maintains persistent working directory state that syncs with the TUI status bar.

---

## Architecture

### New Files

```
packages/opencode/src/shell/
├── mode.ts           # ExecutionMode enum and ModeController class
├── shell.ts          # Shell namespace with convenience functions
├── session-shell.ts  # Per-session shell process management
└── persistent.ts     # PersistentShell class for state management
```

### Modified Files

```
packages/opencode/src/cli/cmd/tui/
├── app.tsx                          # Working directory signal and status bar
├── component/prompt/index.tsx       # Mode integration and keyboard shortcuts
└── component/prompt/autocomplete.tsx # Text extraction fix

packages/opencode/src/session/
└── prompt.ts                        # Shell execution integration
```

---

## Component Specifications

### 1. ExecutionMode Enum (`mode.ts`)

```typescript
export enum ExecutionMode {
  Shell = "Shell",   // Direct shell execution
  Agent = "Agent",   // AI agent processing
  Auto = "Auto"      // Intelligent routing (default)
}
```

### 2. ModeController Class (`mode.ts`)

Singleton class that manages execution mode and provides routing logic.

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `currentMode` | `ExecutionMode` | Current active mode |
| `persistedMode` | `ExecutionMode \| null` | Saved mode for restore |

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `getMode()` | `() => ExecutionMode` | Get current mode |
| `setMode()` | `(mode: ExecutionMode) => void` | Set current mode |
| `toggleMode()` | `() => ExecutionMode` | Cycle: Shell → Agent → Auto → Shell |
| `shouldRouteToShell()` | `async (input: string) => Promise<boolean>` | Auto mode routing decision |
| `getModeDisplay()` | `() => { name, color, icon }` | UI display info |

#### Auto Mode Routing Logic (`shouldRouteToShell`)

Uses the Unix-native approach of checking if a command exists using `command -v` (POSIX) or `which`.

**Algorithm:**

1. Extract the first token from input (the command name)
2. Execute `command -v <first_token>` in a shell
3. If exit code is 0 → command exists → route to **Shell**
4. If exit code is non-zero → command doesn't exist → route to **Agent**

**Implementation:**

```typescript
async shouldRouteToShell(input: string): Promise<boolean> {
  // If not in Auto mode, respect the current mode
  if (this.currentMode === ExecutionMode.Shell) return true
  if (this.currentMode === ExecutionMode.Agent) return false

  const trimmed = input.trim()
  if (!trimmed) return false

  // Extract first token (command name)
  const firstToken = this.extractFirstToken(trimmed)
  if (!firstToken) return false

  // Use `command -v` to check if command exists (POSIX standard)
  // This checks: builtins, functions, aliases, and executables in PATH
  return this.commandExists(firstToken)
}

private async commandExists(cmd: string): Promise<boolean> {
  try {
    const { exited } = Bun.spawn(["sh", "-c", `command -v ${this.shellEscape(cmd)}`], {
      stdout: "ignore",
      stderr: "ignore",
    })
    const exitCode = await exited
    return exitCode === 0
  } catch {
    return false
  }
}

private shellEscape(str: string): string {
  // Escape single quotes for safe shell interpolation
  return `'${str.replace(/'/g, "'\\''")}'`
}
```

**Why `command -v`:**

- **POSIX standard** - works in bash, zsh, sh, dash, etc.
- **Comprehensive** - checks builtins (`cd`, `export`), functions, aliases, and PATH executables
- **No false positives** - only returns 0 if the command actually exists
- **Simple** - single check instead of multiple heuristics

**Routing behavior:**

| Input | First Token | `command -v` Result | Route |
|-------|-------------|---------------------|-------|
| `ls -la` | `ls` | exits 0 (found in PATH) | Shell |
| `cd ~/projects` | `cd` | exits 0 (builtin) | Shell |
| `git status` | `git` | exits 0 (found in PATH) | Shell |
| `export FOO=bar` | `export` | exits 0 (builtin) | Shell |
| `./script.sh` | `./script.sh` | exits 0 (if executable) | Shell |
| `what files are here?` | `what` | exits 1 (not found) | Agent |
| `explain this code` | `explain` | exits 1 (not found) | Agent |
| `asdfqwerty` | `asdfqwerty` | exits 1 (not found) | Agent |

#### First Token Extraction

Simple extraction that handles basic quoting:

```typescript
private extractFirstToken(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // Handle quoted strings at start
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1)
    if (end > 0) return trimmed.slice(1, end)
  }
  if (trimmed.startsWith("'")) {
    const end = trimmed.indexOf("'", 1)
    if (end > 0) return trimmed.slice(1, end)
  }

  // Split on whitespace and return first token
  const spaceIndex = trimmed.search(/\s/)
  if (spaceIndex === -1) return trimmed
  return trimmed.slice(0, spaceIndex)
}
```

### 3. PersistentShell Class (`persistent.ts`)

Maintains shell state across command executions.

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `workingDir` | `string` | Current working directory |
| `environment` | `Map<string, string>` | Environment variables |
| `shellBinary` | `string` | Path to shell (from `$SHELL` or `/bin/sh`) |

#### Methods

| Method | Description |
|--------|-------------|
| `execute(command, options?)` | Execute command with current state |
| `handleCdCommand(command)` | Update `workingDir` on `cd` |
| `handleExportCommand(command)` | Update `environment` on `export` |
| `getWorkingDir()` | Get current working directory |
| `setWorkingDir(dir)` | Set working directory |
| `getEnv(key)` | Get environment variable |
| `setEnv(key, value)` | Set environment variable |
| `getEnvironment()` | Get all environment variables |
| `reset()` | Reset to initial state |

#### Special Command Handling

**`cd` command:**
- `cd` alone → home directory
- `cd path` → resolve relative to current `workingDir`
- Handles `~` expansion
- Validates directory exists
- Updates `workingDir` on success

**`export` command:**
- Parses `export VAR=value`
- Handles quoted values
- Updates `environment` map

### 4. Session Shell (`session-shell.ts`)

Per-session persistent shell process with proper command wrapping.

#### ShellProcess Class

Spawns and manages a persistent shell process per session.

```typescript
class ShellProcess {
  shellPath: string
  shellName: string

  execute(command: string, options: { signal: AbortSignal; onData?: (chunk: string) => void })
  dispose()
  isClosed: boolean
}
```

#### Command Wrapping

Commands are wrapped to capture exit code and working directory:

```bash
{
${command}
}
__opencode_status__=$?
__opencode_cwd__="$(pwd -P 2>/dev/null || pwd)"
printf '\n${sentinel}%s\t%s\n' "$__opencode_status__" "$__opencode_cwd__"
```

The sentinel format is: `__OPENCODE_DONE__${ulid}__:`

#### Shell Initialization

**zsh:**
```bash
[[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
[[ -f "${ZDOTDIR:-$HOME}/.zshrc" ]] && source "${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
```

**bash:**
```bash
[[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
shopt -s expand_aliases >/dev/null 2>&1 || true
```

#### Session Lifecycle

- Shells are created on first use per session
- Disposed after 2 minutes of idle time
- Listens to `session.idle` bus events for cleanup scheduling
- Proper process tree killing on abort/dispose

#### Export Functions

```typescript
export function execute(options: ExecOptions): Promise<ExecResult>
export function dispose(sessionID: string): void

type ExecOptions = {
  sessionID: string
  command: string
  signal: AbortSignal
  onData?: (chunk: string) => void
}

type ExecResult = {
  output: string
  exitCode: number
  cwd?: string  // Updated working directory
}
```

### 5. Shell Namespace (`shell.ts`)

Convenience functions combining ModeController and PersistentShell.

```typescript
export const Shell = {
  get()              // Get PersistentShell instance
  getModeController() // Get ModeController instance
  reset()            // Reset shell state
  getCwd()           // Get current working directory
  setCwd(dir)        // Set working directory
  getMode()          // Get current execution mode
  setMode(mode)      // Set execution mode
  toggleMode()       // Toggle execution mode
}
```

---

## TUI Integration

### 1. Prompt Component (`prompt/index.tsx`)

#### State Changes

```typescript
// OLD
const [store, setStore] = createStore<{
  prompt: PromptInfo
  mode: "normal" | "shell"  // Simple mode
}>()

// NEW
const [store, setStore] = createStore<{
  prompt: PromptInfo
}>()

const modeController = getModeController()
const [executionMode, setExecutionMode] = createSignal<ExecutionMode>(modeController.getMode())
```

#### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Space` | Toggle execution mode (Shell → Agent → Auto) |

#### Mode Toggle Implementation

```typescript
// Ctrl+Space to toggle execution mode
if (
  e.ctrl &&
  !e.meta &&
  !e.shift &&
  (e.name === " " || e.name === "space" || e.sequence === "\x00")
) {
  const newMode = modeController.toggleMode()
  setExecutionMode(newMode)
  e.preventDefault()
  return
}
```

#### Submit Routing Logic

```typescript
async function submit() {
  const currentMode = executionMode()
  let shouldRouteToShell = false

  if (currentMode === ExecutionMode.Shell) {
    shouldRouteToShell = true
  } else if (currentMode === ExecutionMode.Auto) {
    shouldRouteToShell = await modeController.shouldRouteToShell(inputText)
  } else if (currentMode === ExecutionMode.Agent) {
    shouldRouteToShell = false
  }

  if (shouldRouteToShell) {
    sdk.client.session.shell({
      path: { id: sessionID },
      body: { agent: local.agent.current().name, command: inputText },
    })
  } else {
    // Route to agent via sdk.client.session.prompt()
  }
}
```

#### Visual Indicators

**Input prefix (colored icon before text input):**
- `>` = Shell mode (cyan/primary)
- `◆` = Agent mode (magenta/secondary)
- `☯` = Auto mode (green/success)

**Border color:**
- `theme.primary` = Shell mode (cyan)
- `theme.secondary` = Agent mode (magenta)
- `theme.success` = Auto mode (green)

**Status bar:**
- Shows current mode name with matching color: `[Shell]`, `[Agent]`, or `[Auto]`

#### Command Dialog Registration

```typescript
{
  title: "Toggle execution mode",
  value: "mode.toggle",
  category: "Session",
  onSelect: (dialog) => {
    const newMode = modeController.toggleMode()
    setExecutionMode(newMode)
    dialog.clear()
  },
}
```

### 2. App Component (`app.tsx`)

#### Working Directory Signal

```typescript
import { Shell } from "@/shell/shell"

const [workingDir, setWorkingDir] = createSignal(Shell.getCwd())
```

#### Working Directory Sync Effect

```typescript
createEffect(() => {
  if (route.data.type !== "session") {
    setWorkingDir(Shell.getCwd())
    return
  }

  const data = route.data as SessionRoute
  const messages = sync.data.message[data.sessionID] ?? []

  // Find latest assistant message
  let latest: (typeof messages)[number] | undefined
  for (const message of messages) {
    if (message.role !== "assistant") continue
    if (!latest || message.id > latest.id) {
      latest = message
    }
  }

  // Use cwd from latest assistant message
  if (latest && latest.role === "assistant") {
    if (workingDir() !== latest.path.cwd) {
      setWorkingDir(latest.path.cwd)
    }
    return
  }

  // Fallback to session directory
  const session = sync.session.get(data.sessionID)
  if (session) {
    if (workingDir() !== session.directory) {
      setWorkingDir(session.directory)
    }
  }
})
```

#### Polling for Non-Session Routes

```typescript
createEffect(() => {
  if (route.data.type === "session") return
  const interval = setInterval(() => {
    const currentDir = Shell.getCwd()
    setWorkingDir(currentDir)
  }, 500)
  return () => clearInterval(interval)
})
```

#### Status Bar Display

```typescript
<box paddingLeft={1} paddingRight={1}>
  <text fg={theme.textMuted}>
    {workingDir().replace(Global.Path.home, "~")}
  </text>
</box>
```

### 3. Autocomplete Fix (`autocomplete.tsx`)

Changed text extraction method:

```typescript
// OLD (broken)
props.input().getTextRange(store.index + 1, props.input().cursorOffset + 1)

// NEW (working)
props.input().plainText.slice(store.index + 1, props.input().cursorOffset + 1)
```

---

## Session/Prompt Integration (`session/prompt.ts`)

### Working Directory in Messages

Messages now use `Shell.getCwd()` instead of `Instance.directory`:

```typescript
path: {
  cwd: Shell.getCwd(),  // Dynamic, updated by shell commands
  root: Instance.worktree,
}
```

### Shell Execution (`bashSync` function)

Replaced inline shell spawning with `SessionShellExecute`:

```typescript
// OLD: Inline spawn with shell-specific rc file sourcing
const proc = spawn(shell, args, { cwd: Instance.directory, ... })

// NEW: Use session-shell module
const exec = await SessionShellExecute({
  sessionID: input.sessionID,
  command: input.command,
  signal: abort.signal,
  onData: (chunk) => {
    output += chunk
    // Update part with streaming output
  },
})

// Update working directory if changed
if (exec.ok && exec.result.cwd) {
  Shell.setCwd(exec.result.cwd)
  await Session.update(input.sessionID, (draft) => {
    draft.directory = exec.result.cwd!
  })
}
```

### Batched Message Updates

```typescript
// OLD: Sequential updates
await Session.updateMessage(userMsg)
await Session.updatePart(userPart)
await Session.updateMessage(msg)
await Session.updatePart(part)

// NEW: Parallel updates
await Promise.all([
  Session.updateMessage(userMsg),
  Session.updatePart(userPart),
  Session.updateMessage(msg),
  Session.updatePart(part),
])
```

---

## Sync Context Updates (`context/sync.tsx`)

### Message Reconciliation

Prevents race conditions where older messages overwrite newer ones:

```typescript
setStore("message", incoming.sessionID, result.index, (previous) => {
  if (!previous) return incoming
  if (previous.role !== "assistant") return reconcile(incoming)(previous)
  if (incoming.role !== "assistant") return reconcile(incoming)(previous)

  const previousCompleted = previous.time.completed
  const incomingCompleted = incoming.time.completed

  // Keep previous if it's completed and incoming isn't
  if (previousCompleted && !incomingCompleted) return previous

  // Keep previous if both completed but previous is newer
  if (previousCompleted && incomingCompleted && incomingCompleted < previousCompleted)
    return previous

  return reconcile(incoming)(previous)
})
```

---

## User Experience

### Mode Indicators

| Mode | Input Prefix | Color | Status Text |
|------|--------------|-------|-------------|
| Shell | `>` | `theme.primary` (cyan) | "[Shell]" |
| Agent | `◆` | `theme.secondary` (magenta) | "[Agent]" |
| Auto | `☯` | `theme.success` (green) | "[Auto]" |

### Keyboard Shortcuts Summary

| Shortcut | Context | Action |
|----------|---------|--------|
| `Ctrl+Space` | Prompt | Toggle mode (Shell → Agent → Auto) |
| `Ctrl+P` → "Toggle execution mode" | Command palette | Toggle mode |

### Working Directory Behavior

1. **Initial state**: Project directory (`Instance.directory`)
2. **After `cd` command**: Updates to new directory
3. **Status bar**: Shows `~/path` (with home directory abbreviated)
4. **Per-session**: Each session tracks its own working directory
5. **Message metadata**: Every assistant message records `path.cwd`

---

## Implementation Checklist

### New Files to Create

- [ ] `src/shell/mode.ts` - ExecutionMode enum and ModeController
- [ ] `src/shell/shell.ts` - Shell namespace with convenience functions
- [ ] `src/shell/session-shell.ts` - Per-session shell process management
- [ ] `src/shell/persistent.ts` - PersistentShell class

### Files to Modify

- [ ] `src/cli/cmd/tui/app.tsx`
  - [ ] Import Shell
  - [ ] Add workingDir signal
  - [ ] Add working directory sync effect
  - [ ] Add polling effect for non-session routes
  - [ ] Update status bar to use workingDir()

- [ ] `src/cli/cmd/tui/component/prompt/index.tsx`
  - [ ] Import getModeController, ExecutionMode
  - [ ] Add executionMode signal
  - [ ] Remove `mode` from store (no longer needed)
  - [ ] Add Ctrl+Space handler for mode toggle
  - [ ] Update submit() routing logic
  - [ ] Update visual indicators (prompt char, border, status)
  - [ ] Register "Toggle execution mode" command

- [ ] `src/cli/cmd/tui/component/prompt/autocomplete.tsx`
  - [ ] Change getTextRange() to plainText.slice()

- [ ] `src/session/prompt.ts`
  - [ ] Import SessionShellExecute, Shell
  - [ ] Update path.cwd to use Shell.getCwd()
  - [ ] Replace bashSync shell spawning with SessionShellExecute
  - [ ] Update session directory on cwd change
  - [ ] Batch message updates with Promise.all()

- [ ] `src/cli/cmd/tui/context/sync.tsx`
  - [ ] Add message reconciliation logic

---

## Testing Scenarios

### Mode Switching

1. Start in Auto mode (default)
2. Press `Ctrl+Space` → Should show "Agent"
3. Press `Ctrl+Space` → Should show "Shell"
4. Press `Ctrl+Space` → Should show "Auto"

### Auto Mode Routing

Uses `command -v <first_token>` to determine routing:

| Input | First Token | `command -v` exits 0? | Route |
|-------|-------------|----------------------|-------|
| `ls -la` | `ls` | Yes (PATH) | Shell |
| `cd ~/projects` | `cd` | Yes (builtin) | Shell |
| `git status` | `git` | Yes (PATH) | Shell |
| `export FOO=bar` | `export` | Yes (builtin) | Shell |
| `./script.sh` | `./script.sh` | Yes (if exists) | Shell |
| `npm install` | `npm` | Yes (PATH) | Shell |
| `docker ps` | `docker` | Yes (PATH) | Shell |
| `what files are in this directory?` | `what` | No | Agent |
| `explain this code` | `explain` | No | Agent |
| `help me debug` | `help` | Yes (builtin) | Shell |
| `fix the bug in auth` | `fix` | No | Agent |
| `asdfqwerty` | `asdfqwerty` | No | Agent |

**Note:** The routing is purely based on whether the first word is a valid command. Natural language that happens to start with a valid command (like `help me debug`) will route to shell. Users can switch to Agent mode with `Ctrl+Space` to override.

### Working Directory Sync

1. Run `cd /tmp` in shell mode
2. Status bar should update to `/tmp`
3. Run another command
4. Message metadata should show `path.cwd: "/tmp"`
5. New session should start in project directory

