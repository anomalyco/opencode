# Shell/Agent Execution Mode Feature Specification

The shell/agent/auto mode is completely independent from the build, plan, etc. mode.

## Overview

This feature adds intelligent input routing between direct shell execution and AI agent processing. Users can work in three modes:

- **Shell Mode**: All input is executed directly in the shell
- **Agent Mode**: All input is processed by the AI agent
- **Auto Mode**: Input is routed based on command existence check (default)

Additionally, the shell maintains persistent working directory state that syncs with the TUI status bar.

---

## Architecture

### Plugin Directory (Feature Logic)

All shell mode feature logic lives in the `plugin/` directory and is imported via tsconfig path aliases:

```
packages/opencode/plugin/
├── shell-mode/
│   ├── index.ts              # Exports: ExecutionMode, ModeController, etc.
│   ├── mode.ts               # ExecutionMode enum and ModeController class
│   ├── command-check.ts      # Command existence checking (command -v)
│   ├── completion.ts         # Shell tab completion
│   ├── cwd.ts                # Working directory management
│   └── session-shell.ts      # Per-session shell process management
│
└── tui-integration/
    ├── index.ts              # Exports: providers, hooks
    ├── execution-mode-provider.tsx  # SolidJS context for execution mode
    ├── working-dir-provider.tsx     # SolidJS context for working directory
    └── hooks.ts              # Keyboard and routing hooks
```

### Modified Upstream Files

Some upstream files require direct modification because their changes are structural (wrapping JSX, integrated logic) and cannot be shimmed without duplicating code:

```
packages/opencode/src/cli/cmd/tui/
├── app.tsx                          # Provider imports and wrapping
├── component/prompt/index.tsx       # Mode integration, keyboard shortcuts, completion
└── component/prompt/history.tsx     # PromptInfo type extension
```

### tsconfig.json Path Aliases

```json
{
  "paths": {
    "@shell-mode": ["./plugin/shell-mode/index.ts"],
    "@shell-mode/*": ["./plugin/shell-mode/*"],
    "@tui-integration": ["./plugin/tui-integration/index.ts"],
    "@tui-integration/*": ["./plugin/tui-integration/*"]
  }
}
```

---

## Component Specifications

### 1. ExecutionMode Enum (`plugin/shell-mode/mode.ts`)

```typescript
export enum ExecutionMode {
  Shell = "Shell",   // Direct shell execution
  Agent = "Agent",   // AI agent processing
  Auto = "Auto"      // Intelligent routing (default)
}
```

### 2. ModeController Class (`plugin/shell-mode/mode.ts`)

Singleton class that manages execution mode and provides routing logic.

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `getMode()` | `() => ExecutionMode` | Get current mode |
| `setMode()` | `(mode: ExecutionMode) => void` | Set current mode |
| `toggleMode()` | `() => ExecutionMode` | Cycle: Shell → Agent → Auto → Shell |
| `getModeDisplay()` | `() => { name, color, icon }` | UI display info |

### 3. Auto Mode Routing (`plugin/shell-mode/command-check.ts`)

Uses `command -v` (POSIX standard) to check if a command exists:

```typescript
export async function shouldRouteToShell(input: string): Promise<boolean>
```

**Algorithm:**
1. Extract the first token from input (the command name)
2. Execute `command -v <first_token>` in a shell
3. If exit code is 0 → command exists → route to **Shell**
4. If exit code is non-zero → command doesn't exist → route to **Agent**

**Routing behavior:**

| Input | First Token | `command -v` Result | Route |
|-------|-------------|---------------------|-------|
| `ls -la` | `ls` | exits 0 (found in PATH) | Shell |
| `cd ~/projects` | `cd` | exits 0 (builtin) | Shell |
| `git status` | `git` | exits 0 (found in PATH) | Shell |
| `what files are here?` | `what` | exits 1 (not found) | Agent |
| `explain this code` | `explain` | exits 1 (not found) | Agent |

### 4. Shell Tab Completion (`plugin/shell-mode/completion.ts`)

Provides shell-style tab completion for file paths and commands:

```typescript
export async function getCompletions(
  input: string,
  cursorPosition: number,
  cwd?: string
): Promise<CompletionResult>

export function applyCompletion(
  input: string,
  completion: string,
  replaceFrom: number,
  replaceTo: number
): string

export function findCommonPrefix(completions: string[]): string
```

### 5. Working Directory (`plugin/shell-mode/cwd.ts`)

Manages the current working directory state:

```typescript
export function getCwd(): string
export function setCwd(dir: string): void
```

---

## TUI Integration

### 1. Providers (`plugin/tui-integration/`)

**ExecutionModeProvider**: SolidJS context for execution mode state
**WorkingDirProvider**: SolidJS context for working directory state

These are wrapped around `<App />` in `src/cli/cmd/tui/app.tsx`:

```tsx
<ExecutionModeProvider>
  <WorkingDirProvider>
    <App />
  </WorkingDirProvider>
</ExecutionModeProvider>
```

### 2. Hooks (`plugin/tui-integration/hooks.ts`)

**handleModeToggleKey**: Handles Ctrl+Space to toggle execution mode
**determineRouting**: Determines shell vs agent routing based on mode
**handleShellTabCompletion**: Handles tab key for shell completion
**shouldUseShellCompletion**: Checks if shell completion should be used

### 3. Prompt Component Changes (`src/cli/cmd/tui/component/prompt/index.tsx`)

- Imports hooks and providers from `@tui-integration`
- Imports `ExecutionMode` from `@shell-mode`
- Uses `useExecutionMode()` hook for mode state
- Calls `handleModeToggleKey()` on keydown
- Calls `determineRouting()` on submit
- Calls `handleShellTabCompletion()` on tab
- Displays mode indicator with icon and color

### 4. Visual Indicators

| Mode | Input Prefix | Color | Status Text |
|------|--------------|-------|-------------|
| Shell | `>` | `theme.primary` (cyan) | "Shell" |
| Agent | `◆` | `theme.secondary` (magenta) | "Agent" |
| Auto | `☯` | `theme.success` (green) | "Auto" |

---

## Keyboard Shortcuts

| Shortcut | Context | Action |
|----------|---------|--------|
| `Ctrl+Space` | Prompt | Toggle mode (Shell → Agent → Auto) |
| `Tab` | Prompt (Shell/Auto mode) | Shell tab completion |
| `!` | Prompt (at start) | Enter legacy shell mode |

---

## Working Directory Behavior

1. **Initial state**: Project directory
2. **After `cd` command**: Updates to new directory
3. **Status bar**: Shows `~/path` (with home directory abbreviated)
4. **Per-session**: Each session tracks its own working directory

---

## Testing Scenarios

### Mode Switching

1. Start in Auto mode (default)
2. Press `Ctrl+Space` → Should show "Shell"
3. Press `Ctrl+Space` → Should show "Agent"
4. Press `Ctrl+Space` → Should show "Auto"

### Auto Mode Routing

| Input | Route |
|-------|-------|
| `ls -la` | Shell |
| `git status` | Shell |
| `what files are here?` | Agent |
| `explain this code` | Agent |

### Tab Completion

1. Type `ls /us` and press Tab → Should complete to `ls /usr/`
2. Type `cd ~/Doc` and press Tab → Should complete to `cd ~/Documents/`
3. Multiple matches → Cycle through with repeated Tab presses
