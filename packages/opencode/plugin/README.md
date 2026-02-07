# Lash Plugin System

This directory contains plugins that extend opencode functionality while keeping feature logic isolated from upstream source files.

## Architecture

```
plugin/
├── shell-mode/            # Shell execution mode feature
│   ├── index.ts           # Exports
│   ├── mode.ts            # ExecutionMode enum, ModeController
│   ├── command-check.ts   # Command existence checking (command -v)
│   ├── natural-language.ts # Natural language detection after shell errors
│   ├── completion.ts      # Shell tab completion
│   ├── cwd.ts             # Working directory state
│   └── session-shell.ts   # Per-session shell process
│
└── tui-integration/       # TUI providers and hooks
    ├── index.ts           # Exports
    ├── execution-mode-provider.tsx  # SolidJS context
    ├── working-dir-provider.tsx     # SolidJS context
    └── hooks.ts           # Keyboard and routing hooks
```

## How It Works

### tsconfig Path Aliases

Plugin code is imported via path aliases defined in `tsconfig.json`:

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

This allows clean imports in upstream files:

```typescript
import { ExecutionMode } from "@shell-mode"
import { useExecutionMode, handleModeToggleKey } from "@tui-integration"
```

### Upstream Modifications

Some upstream files require direct modification because shimming would require code duplication:

| File                                           | Changes                          |
| ---------------------------------------------- | -------------------------------- |
| `src/cli/cmd/tui/app.tsx`                      | Import providers, wrap `<App />` |
| `src/cli/cmd/tui/component/prompt/index.tsx`   | Import hooks, mode integration   |
| `src/cli/cmd/tui/component/prompt/history.tsx` | Type extension                   |

### Why Not Shims?

We considered using build-time shims but rejected them because:

- **JSX structure changes** (provider wrapping) would require duplicating the entire component
- **Integrated logic** (mode toggle, completion) is woven throughout components
- **Type changes** are embedded in the same files as code

Shims work for wrapping function exports or extending classes, but not for structural JSX changes.

## Upstream Merge Workflow

1. Pull upstream changes: `git merge upstream/dev`
2. Resolve conflicts in modified files (re-add plugin imports and hooks)
3. Plugin code is unaffected (lives in separate directory)

## Benefits

1. **Feature logic isolated** - All shell mode logic in `plugin/`
2. **Minimal upstream changes** - Only structural changes that can't be shimmed
3. **Clean imports** - tsconfig path aliases
4. **Easy to understand** - No magic build transforms
5. **Type safety** - Full TypeScript support
