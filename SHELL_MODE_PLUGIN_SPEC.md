# Shell/Agent Mode - Plugin Architecture Specification

## Overview

This spec describes how to implement the Shell/Agent execution mode feature as a **plugin** that hooks into the upstream codebase without modifying upstream files. This allows for easy upstream merges since no upstream files are edited directly.

---

## Architecture Principles

1. **Zero upstream file edits** - All feature code lives in separate plugin directories
2. **Hook-based integration** - Use existing extension points or minimal shim files
3. **Override pattern** - Plugin exports replace or wrap upstream exports
4. **Build-time integration** - Plugin code is bundled alongside upstream code

---

## Directory Structure

```
packages/opencode/
├── src/                          # Upstream code (DO NOT EDIT)
│   ├── session/
│   ├── cli/
│   └── ...
│
├── plugin/                       # Plugin code (EDIT THIS)
│   ├── shell-mode/
│   │   ├── index.ts              # Plugin entry point
│   │   ├── mode.ts               # ExecutionMode enum and ModeController
│   │   ├── shell.ts              # Shell namespace
│   │   ├── session-shell.ts      # Per-session shell process
│   │   └── persistent.ts         # PersistentShell class
│   │
│   ├── tui-overrides/
│   │   ├── index.ts              # TUI override entry point
│   │   ├── prompt.tsx            # Extended Prompt component
│   │   ├── app.tsx               # Extended App component
│   │   └── hooks.ts              # Keyboard and submission hooks
│   │
│   └── index.ts                  # Main plugin registration
│
├── shims/                        # Minimal shim files (EDIT SPARINGLY)
│   ├── session-prompt.ts         # Shim that imports plugin hooks
│   └── tui-entry.ts              # Shim that wraps TUI with plugin providers
│
└── lash.config.ts                # Plugin configuration
```

---

## Integration Strategy

### Option A: Build-Time Path Aliasing (Recommended)

Use TypeScript/bundler path aliases to redirect imports to plugin versions.

**`tsconfig.json` additions:**
```json
{
  "compilerOptions": {
    "paths": {
      "@shell-mode": ["./plugin/shell-mode/index.ts"],
      "@shell-mode/*": ["./plugin/shell-mode/*"],
      "@tui-overrides": ["./plugin/tui-overrides/index.ts"],
      "@tui-overrides/*": ["./plugin/tui-overrides/*"]
    }
  }
}
```

**`bunfig.toml` or build script:**
```toml
[install]
# Plugin aliases
"@shell-mode" = "./plugin/shell-mode/index.ts"
```

### Option B: Wrapper/Shim Pattern

Create thin shim files that import from both upstream and plugin, then re-export the combined functionality.

**Example shim (`shims/session-prompt.ts`):**
```typescript
// Re-export everything from upstream
export * from "../src/session/prompt"

// Import plugin hooks
import { shellModeHooks } from "@shell-mode"

// Register hooks on module load
shellModeHooks.register()
```

### Option C: Runtime Plugin Registration

Use a plugin registry that upstream code checks at runtime.

**Plugin registration (`plugin/index.ts`):**
```typescript
import { PluginRegistry } from "../src/plugin/registry"
import { ShellModePlugin } from "./shell-mode"
import { TuiOverridesPlugin } from "./tui-overrides"

PluginRegistry.register("shell-mode", ShellModePlugin)
PluginRegistry.register("tui-overrides", TuiOverridesPlugin)
```

---

## Plugin Components

### 1. Shell Mode Core (`plugin/shell-mode/`)

This is identical to the original spec but lives in the plugin directory.

**`plugin/shell-mode/index.ts`:**
```typescript
export { ExecutionMode, ModeController, getModeController } from "./mode"
export { Shell } from "./shell"
export { execute as SessionShellExecute, dispose } from "./session-shell"
export { PersistentShell, getPersistentShell } from "./persistent"
```

**`plugin/shell-mode/mode.ts`:**
```typescript
import { Log } from "../../src/util/log"

export enum ExecutionMode {
  Shell = "Shell",
  Agent = "Agent",
  Auto = "Auto"
}

export class ModeController {
  private currentMode: ExecutionMode = ExecutionMode.Auto

  getMode(): ExecutionMode {
    return this.currentMode
  }

  setMode(mode: ExecutionMode): void {
    this.currentMode = mode
  }

  toggleMode(): ExecutionMode {
    const modes = [ExecutionMode.Shell, ExecutionMode.Agent, ExecutionMode.Auto]
    const currentIndex = modes.indexOf(this.currentMode)
    this.currentMode = modes[(currentIndex + 1) % modes.length]
    return this.currentMode
  }

  async shouldRouteToShell(input: string): Promise<boolean> {
    if (this.currentMode === ExecutionMode.Shell) return true
    if (this.currentMode === ExecutionMode.Agent) return false

    const firstToken = this.extractFirstToken(input.trim())
    if (!firstToken) return false

    return this.commandExists(firstToken)
  }

  private extractFirstToken(input: string): string | null {
    if (!input) return null
    const spaceIndex = input.search(/\s/)
    if (spaceIndex === -1) return input
    return input.slice(0, spaceIndex)
  }

  private async commandExists(cmd: string): Promise<boolean> {
    try {
      const escaped = `'${cmd.replace(/'/g, "'\\''")}'`
      const { exited } = Bun.spawn(["sh", "-c", `command -v ${escaped}`], {
        stdout: "ignore",
        stderr: "ignore",
      })
      return (await exited) === 0
    } catch {
      return false
    }
  }
}

let instance: ModeController | null = null
export function getModeController(): ModeController {
  if (!instance) instance = new ModeController()
  return instance
}
```

#### Visual Indicators

The `getModeDisplay()` method returns icon, name, and color for each mode:

| Mode | Icon | Color | Theme Color |
|------|------|-------|-------------|
| Shell | `>` | `primary` | cyan |
| Agent | `◆` | `secondary` | magenta |
| Auto | `☯` | `success` | green |

```typescript
type ModeDisplay = {
  name: string
  icon: string
  color: "primary" | "secondary" | "success" | "border"
}

getModeDisplay(): ModeDisplay {
  switch (this.currentMode) {
    case ExecutionMode.Shell:
      return { name: "Shell", icon: ">", color: "primary" }
    case ExecutionMode.Agent:
      return { name: "Agent", icon: "◆", color: "secondary" }
    case ExecutionMode.Auto:
      return { name: "Auto", icon: "☯", color: "success" }
  }
}
```

The input prefix shows the mode icon with the corresponding color, and the status bar displays `[Mode]` with matching color.

### 2. TUI Overrides (`plugin/tui-overrides/`)

**`plugin/tui-overrides/hooks.ts`:**
```typescript
import { getModeController, ExecutionMode } from "@shell-mode"
import { Shell } from "@shell-mode"

export type SubmitHook = {
  shouldIntercept: (input: string) => Promise<boolean>
  handle: (input: string, context: SubmitContext) => Promise<void>
}

export type KeyboardHook = {
  matches: (event: KeyEvent) => boolean
  handle: (event: KeyEvent, context: KeyboardContext) => void
}

export type SubmitContext = {
  sessionID: string
  sdk: SDK
  agent: string
}

export type KeyboardContext = {
  setExecutionMode: (mode: ExecutionMode) => void
}

/**
 * Hook: Intercept submission and route to shell if needed
 */
export const shellModeSubmitHook: SubmitHook = {
  async shouldIntercept(input: string) {
    const mode = getModeController().getMode()
    if (mode === ExecutionMode.Agent) return false
    if (mode === ExecutionMode.Shell) return true
    return getModeController().shouldRouteToShell(input)
  },

  async handle(input: string, ctx: SubmitContext) {
    await ctx.sdk.client.session.shell({
      path: { id: ctx.sessionID },
      body: { agent: ctx.agent, command: input },
    })
  }
}

/**
 * Hook: Ctrl+Space to toggle mode
 */
export const modeToggleKeyboardHook: KeyboardHook = {
  matches(event) {
    return (
      event.ctrl &&
      !event.meta &&
      !event.shift &&
      (event.name === " " || event.name === "space" || event.sequence === "\x00")
    )
  },

  handle(event, ctx) {
    const newMode = getModeController().toggleMode()
    ctx.setExecutionMode(newMode)
  }
}

/**
 * Registry for all hooks
 */
export const hooks = {
  submit: [shellModeSubmitHook],
  keyboard: [modeToggleKeyboardHook],
}
```

**`plugin/tui-overrides/providers.tsx`:**
```typescript
import { createContext, useContext, createSignal, type ParentProps } from "solid-js"
import { getModeController, ExecutionMode, Shell } from "@shell-mode"

// Execution Mode Context
type ExecutionModeContextValue = {
  mode: () => ExecutionMode
  setMode: (mode: ExecutionMode) => void
  toggleMode: () => ExecutionMode
}

const ExecutionModeContext = createContext<ExecutionModeContextValue>()

export function ExecutionModeProvider(props: ParentProps) {
  const controller = getModeController()
  const [mode, setModeSignal] = createSignal(controller.getMode())

  const setMode = (m: ExecutionMode) => {
    controller.setMode(m)
    setModeSignal(m)
  }

  const toggleMode = () => {
    const newMode = controller.toggleMode()
    setModeSignal(newMode)
    return newMode
  }

  return (
    <ExecutionModeContext.Provider value={{ mode, setMode, toggleMode }}>
      {props.children}
    </ExecutionModeContext.Provider>
  )
}

export function useExecutionMode() {
  const ctx = useContext(ExecutionModeContext)
  if (!ctx) throw new Error("useExecutionMode must be used within ExecutionModeProvider")
  return ctx
}

// Working Directory Context
type WorkingDirContextValue = {
  workingDir: () => string
  setWorkingDir: (dir: string) => void
}

const WorkingDirContext = createContext<WorkingDirContextValue>()

export function WorkingDirProvider(props: ParentProps) {
  const [workingDir, setWorkingDir] = createSignal(Shell.getCwd())

  return (
    <WorkingDirContext.Provider value={{ workingDir, setWorkingDir }}>
      {props.children}
    </WorkingDirContext.Provider>
  )
}

export function useWorkingDir() {
  const ctx = useContext(WorkingDirContext)
  if (!ctx) throw new Error("useWorkingDir must be used within WorkingDirProvider")
  return ctx
}
```

**`plugin/tui-overrides/index.ts`:**
```typescript
export * from "./hooks"
export * from "./providers"
```

---

## Shim Files (Minimal Upstream Touch Points)

These are the **only** files that need to exist to bridge upstream and plugin code. They should be as thin as possible.

### Shim 1: TUI Entry Wrapper

**`shims/tui-entry.tsx`:**
```typescript
/**
 * This shim wraps the upstream TUI app with plugin providers.
 * It's the entry point for the TUI instead of the upstream app.tsx.
 */
import { render } from "@opentui/solid"
import { ExecutionModeProvider, WorkingDirProvider } from "@tui-overrides"

// Import the original App but don't render it directly
import { AppProviders, AppContent } from "../src/cli/cmd/tui/app"

export function tui(input: TuiInput) {
  return new Promise<void>(async (resolve) => {
    render(() => (
      <AppProviders input={input} onExit={() => resolve()}>
        {/* Plugin providers wrap the content */}
        <ExecutionModeProvider>
          <WorkingDirProvider>
            <AppContent />
          </WorkingDirProvider>
        </ExecutionModeProvider>
      </AppProviders>
    ))
  })
}
```

### Shim 2: Prompt Hook Integration

**`shims/prompt-hooks.ts`:**
```typescript
/**
 * This shim exports hook integration functions that the Prompt component
 * can optionally call if they exist.
 */
import { hooks } from "@tui-overrides"

export async function runSubmitHooks(input: string, context: any): Promise<boolean> {
  for (const hook of hooks.submit) {
    if (await hook.shouldIntercept(input)) {
      await hook.handle(input, context)
      return true // Intercepted
    }
  }
  return false // Not intercepted, continue with default
}

export function runKeyboardHooks(event: any, context: any): boolean {
  for (const hook of hooks.keyboard) {
    if (hook.matches(event)) {
      hook.handle(event, context)
      return true // Handled
    }
  }
  return false // Not handled
}
```

### Shim 3: Session Shell Integration

**`shims/session-shell-hook.ts`:**
```typescript
/**
 * Hook for session/prompt.ts to use plugin shell execution
 */
import { SessionShellExecute, Shell } from "@shell-mode"

export { SessionShellExecute, Shell }

// Re-export a function that matches the expected interface
export async function executeShellCommand(options: {
  sessionID: string
  command: string
  signal: AbortSignal
  onData?: (chunk: string) => void
}) {
  return SessionShellExecute(options)
}

export function getWorkingDirectory(): string {
  return Shell.getCwd()
}

export function setWorkingDirectory(dir: string): void {
  Shell.setCwd(dir)
}
```

---

## Build Configuration

### Option 1: Bun Build with Plugins

**`build.ts` modifications:**
```typescript
import { build } from "bun"

await build({
  entrypoints: ["./src/cli/index.ts"],
  outdir: "./dist",
  // Plugin aliases
  alias: {
    "@shell-mode": "./plugin/shell-mode/index.ts",
    "@tui-overrides": "./plugin/tui-overrides/index.ts",
  },
  // External plugins loaded at build time
  plugins: [
    {
      name: "lash-plugins",
      setup(build) {
        // Redirect TUI entry to shim
        build.onResolve({ filter: /cli\/cmd\/tui\/app$/ }, () => ({
          path: "./shims/tui-entry.tsx",
        }))
      }
    }
  ]
})
```

### Option 2: Package.json Exports Map

**`package.json`:**
```json
{
  "imports": {
    "#shell-mode": "./plugin/shell-mode/index.ts",
    "#shell-mode/*": "./plugin/shell-mode/*.ts",
    "#tui-overrides": "./plugin/tui-overrides/index.ts",
    "#tui-overrides/*": "./plugin/tui-overrides/*.ts"
  }
}
```

---

## Integration Points Summary

| Feature | Integration Method | Files Touched |
|---------|-------------------|---------------|
| Shell Mode Core | Plugin directory, no upstream changes | `plugin/shell-mode/*` |
| Mode Toggle (Ctrl+Space) | Keyboard hook | `plugin/tui-overrides/hooks.ts` |
| Submit Routing | Submit hook | `plugin/tui-overrides/hooks.ts` |
| Working Directory | Context provider | `plugin/tui-overrides/providers.tsx` |
| TUI Providers | Entry shim | `shims/tui-entry.tsx` |
| Shell Execution | Session hook | `shims/session-shell-hook.ts` |

---

## Upstream Merge Workflow

### When Upstream Updates

1. **Pull upstream changes:**
   ```bash
   git fetch upstream
   git merge upstream/dev
   ```

2. **Conflicts should be minimal** since plugin code is separate

3. **Check shim compatibility:**
   - If upstream changed `app.tsx` exports, update `shims/tui-entry.tsx`
   - If upstream changed `session/prompt.ts` interface, update `shims/session-shell-hook.ts`

4. **Run tests to verify integration**

### Shim Maintenance

Shims are the only potential conflict points. Keep them:
- **Thin** - Just imports and re-exports
- **Stable** - Based on stable upstream interfaces
- **Documented** - Clear comments on what they bridge

---

## Alternative: Monkey Patching (Not Recommended)

If build-time integration isn't possible, runtime monkey patching can work but is fragile:

```typescript
// plugin/monkey-patch.ts
import { SessionPrompt } from "../src/session/prompt"
import { Shell, SessionShellExecute } from "@shell-mode"

// Save original
const originalBashSync = SessionPrompt.bashSync

// Patch with plugin version
SessionPrompt.bashSync = async function(input) {
  // Use plugin shell execution
  const result = await SessionShellExecute({
    sessionID: input.sessionID,
    command: input.command,
    signal: input.abort.signal,
  })

  if (result.cwd) {
    Shell.setCwd(result.cwd)
  }

  return result
}
```

**Why not recommended:**
- Fragile to upstream changes
- Hard to debug
- Type safety issues
- Order-dependent initialization

---

## Recommended Approach

**Use Option A (Build-Time Path Aliasing) + Minimal Shims**

1. All feature code in `plugin/` directory
2. Use TypeScript path aliases for clean imports
3. Single entry shim (`shims/tui-entry.tsx`) to inject providers
4. Build plugin rewrites the TUI entry point
5. Upstream files remain untouched

This gives:
- Clean separation of concerns
- Easy upstream merges
- Full type safety
- Testable plugin code
- Minimal integration surface

---

## Implementation Checklist

### Phase 1: Plugin Infrastructure
- [ ] Create `plugin/` directory structure
- [ ] Set up path aliases in `tsconfig.json`
- [ ] Configure build to include plugin code

### Phase 2: Shell Mode Core
- [ ] Implement `plugin/shell-mode/mode.ts`
- [ ] Implement `plugin/shell-mode/shell.ts`
- [ ] Implement `plugin/shell-mode/session-shell.ts`
- [ ] Implement `plugin/shell-mode/persistent.ts`
- [ ] Create `plugin/shell-mode/index.ts` exports

### Phase 3: TUI Integration
- [ ] Create `plugin/tui-overrides/hooks.ts`
- [ ] Create `plugin/tui-overrides/providers.tsx`
- [ ] Create `shims/tui-entry.tsx`
- [ ] Update build to use TUI shim entry

### Phase 4: Session Integration
- [ ] Create `shims/session-shell-hook.ts`
- [ ] Verify shell execution works through hook

### Phase 5: Testing
- [ ] Test mode switching
- [ ] Test auto-routing with `command -v`
- [ ] Test working directory persistence
- [ ] Test upstream merge simulation
