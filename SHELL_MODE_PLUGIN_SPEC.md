# Shell/Agent Mode - Plugin Architecture Specification

## Overview

This spec describes how the Shell/Agent execution mode feature is implemented using a **plugin architecture** that minimizes upstream file modifications while keeping feature logic isolated.

---

## Architecture Principles

1. **Feature logic in plugin directory** - All shell mode logic lives in `plugin/`
2. **tsconfig path aliases** - Clean imports via `@shell-mode` and `@tui-integration`
3. **Minimal upstream modifications** - Only modify upstream files when shimming would require code duplication
4. **No shims** - Shims were considered but rejected because they would duplicate upstream code

---

## Directory Structure

```
packages/opencode/
├── src/                          # Upstream code (modify sparingly)
│   ├── cli/cmd/tui/
│   │   ├── app.tsx               # MODIFIED: provider wrapping
│   │   └── component/prompt/
│   │       ├── index.tsx         # MODIFIED: mode integration
│   │       └── history.tsx       # MODIFIED: type extension
│   └── ...
│
├── plugin/                       # Plugin code (all feature logic)
│   ├── shell-mode/
│   │   ├── index.ts              # Plugin exports
│   │   ├── mode.ts               # ExecutionMode enum and ModeController
│   │   ├── command-check.ts      # Command existence checking
│   │   ├── natural-language.ts   # Natural language detection after shell errors
│   │   ├── completion.ts         # Shell tab completion
│   │   ├── cwd.ts                # Working directory state
│   │   └── session-shell.ts      # Per-session shell process
│   │
│   └── tui-integration/
│       ├── index.ts              # TUI integration exports
│       ├── execution-mode-provider.tsx  # SolidJS context
│       ├── working-dir-provider.tsx     # SolidJS context
│       └── hooks.ts              # Keyboard and routing hooks
│
└── tsconfig.json                 # Path aliases for plugin imports
```

---

## Integration Strategy: tsconfig Path Aliases

Use TypeScript path aliases to import plugin code cleanly:

**`tsconfig.json`:**

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "@tui/*": ["./src/cli/cmd/tui/*"],
      "@plugin/*": ["./plugin/*"],
      "@shell-mode": ["./plugin/shell-mode/index.ts"],
      "@shell-mode/*": ["./plugin/shell-mode/*"],
      "@tui-integration": ["./plugin/tui-integration/index.ts"],
      "@tui-integration/*": ["./plugin/tui-integration/*"]
    }
  }
}
```

This allows clean imports in upstream files:

```typescript
import { ExecutionMode } from "@shell-mode"
import { useExecutionMode, handleModeToggleKey } from "@tui-integration"
```

---

## Why Not Shims?

We initially considered using shims to avoid upstream modifications. The idea was:

1. Create shim files in `plugin/shims/`
2. Use Bun build plugins or tsconfig to redirect imports to shims
3. Shims would import from original, wrap/extend, and re-export

**Why this doesn't work for our use case:**

| File                 | Change Type                                          | Why Shimming Fails                                 |
| -------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| `app.tsx`            | Wrap `<App />` with providers                        | Would need to duplicate entire provider tree JSX   |
| `prompt/index.tsx`   | Integrated mode logic, keyboard handlers, completion | Logic is woven throughout component, not wrappable |
| `prompt/history.tsx` | Type extension                                       | Type changes embedded in file                      |

**Shimming only works for:**

- Wrapping function exports
- Extending classes
- Adding middleware to pipelines

**Shimming fails for:**

- JSX structure changes (provider wrapping)
- Logic integrated throughout a component
- Type definitions in the same file as code

---

## Modified Upstream Files

These files MUST be modified directly. Keep changes minimal and well-documented.

### 1. `src/cli/cmd/tui/app.tsx`

**Changes:**

- Import providers from `@tui-integration`
- Wrap `<App />` with `<ExecutionModeProvider>` and `<WorkingDirProvider>`

```typescript
// Added import
import { ExecutionModeProvider, WorkingDirProvider } from "@tui-integration"

// In render tree, wrap App:
<ExecutionModeProvider>
  <WorkingDirProvider>
    <App />
  </WorkingDirProvider>
</ExecutionModeProvider>
```

### 2. `src/cli/cmd/tui/component/prompt/index.tsx`

**Changes:**

- Import hooks from `@tui-integration`
- Import `ExecutionMode` from `@shell-mode`
- Use `useExecutionMode()` hook
- Call `handleModeToggleKey()` in keydown handler
- Call `determineRouting()` in submit handler
- Call `handleShellTabCompletion()` for tab completion
- Display mode indicator with icon and color

### 3. `src/cli/cmd/tui/component/prompt/history.tsx`

**Changes:**

- Add `mode?: "normal" | "shell"` to `PromptInfo` type

---

## Plugin Components

### Shell Mode Core (`plugin/shell-mode/`)

**`index.ts` exports:**

```typescript
export { ExecutionMode, ModeController, getModeController } from "./mode"
export { shouldRouteToShell } from "./command-check"
export { detectNaturalLanguage } from "./natural-language"
export { getCompletions, applyCompletion, findCommonPrefix } from "./completion"
export { getCwd, setCwd } from "./cwd"
export { execute as SessionShellExecute } from "./session-shell"
```

### TUI Integration (`plugin/tui-integration/`)

**`index.ts` exports:**

```typescript
export { ExecutionModeProvider, useExecutionMode } from "./execution-mode-provider"
export { WorkingDirProvider, useWorkingDir } from "./working-dir-provider"
export {
  handleModeToggleKey,
  determineRouting,
  handleShellTabCompletion,
  shouldUseShellCompletion,
  applyCompletionAtIndex,
  type CompletionCycleState,
} from "./hooks"
```

---

## Upstream Merge Workflow

### When Upstream Updates

1. **Pull upstream changes:**

   ```bash
   git fetch upstream
   git merge upstream/dev
   ```

2. **Resolve conflicts** in the modified files:
   - `app.tsx` - Re-add provider wrapping
   - `prompt/index.tsx` - Re-add hook imports and calls
   - `prompt/history.tsx` - Re-add type extension

3. **Plugin code is unaffected** - Lives in separate directory

### Minimizing Merge Conflicts

- Keep upstream changes **minimal and localized**
- Use **imports from plugin** rather than inline logic
- Document changes with comments like `// LASH: shell mode integration`

---

## Summary

| Component             | Location                                | Approach                          |
| --------------------- | --------------------------------------- | --------------------------------- |
| Feature logic         | `plugin/shell-mode/`                    | Isolated, no upstream changes     |
| NL detection          | `plugin/shell-mode/natural-language.ts` | Post-execution error analysis     |
| TUI providers & hooks | `plugin/tui-integration/`               | Isolated, no upstream changes     |
| Provider wrapping     | `src/cli/cmd/tui/app.tsx`               | Direct modification (unavoidable) |
| Prompt integration    | `src/.../prompt/index.tsx`              | Direct modification (unavoidable) |
| Type extension        | `src/.../prompt/history.tsx`            | Direct modification (unavoidable) |
| Import aliases        | `tsconfig.json`                         | Clean plugin imports              |

**Key insight:** Shims are useful when you can wrap/extend exports. For structural JSX changes and integrated component logic, direct modification is cleaner than duplicating code.
