# Lash Plugin System

This directory contains plugins that extend opencode functionality without modifying upstream source files.

## Architecture

The plugin system uses Bun's build-time plugin API to inject code transformations:

```
plugin/
├── bun-shim-plugin.ts     # Build plugin that handles module substitution
├── shell-mode/            # Shell execution mode feature
├── tui-integration/       # TUI providers and hooks
└── shims/                 # (Optional) Complete module replacements
```

## How It Works

### Strategy 1: Source Transformation (Recommended)

The `bun-shim-plugin.ts` uses Bun's `onLoad` hook to transform source files at build time:

```typescript
const SOURCE_TRANSFORMS: SourceTransform[] = [
  {
    file: "cli/cmd/tui/app.tsx",
    addImports: [
      'import { ExecutionModeProvider } from "@tui-integration"',
    ],
    replacements: [
      ["<App />", "<ExecutionModeProvider><App /></ExecutionModeProvider>"],
    ],
  },
]
```

This injects the import and wraps the component **without modifying the original file**.

### Strategy 2: Module Replacement

For complete module replacements, use `SHIM_MAP`:

```typescript
const SHIM_MAP: Record<string, string> = {
  "@/session/prompt": "./shims/session/prompt.ts",
}
```

Shims can import the original module using the `original:` prefix:

```typescript
// In plugin/shims/session/prompt.ts
export * from "original:@/session/prompt"

// Override specific exports
export function myOverride() { ... }
```

## Build Integration

Add the plugin to `script/build.ts`:

```typescript
import solidPlugin from "../node_modules/@opentui/solid/scripts/solid-plugin"
import { createShimPlugin } from "../plugin/bun-shim-plugin"

// ...

await Bun.build({
  // ...
  plugins: [solidPlugin, createShimPlugin()],
  // ...
})
```

## Benefits

1. **Zero upstream file changes** - All modifications happen at build time
2. **Easy upstream merges** - No conflicts with upstream changes
3. **Clear separation** - Plugin code is isolated in `plugin/` directory
4. **Type safety** - Full TypeScript support
5. **Testable** - Plugin code can be tested independently

## Reverting to Upstream

If you've previously modified upstream files, you can revert them:

```bash
# See which upstream files were modified
git diff dev --name-only -- packages/opencode/src

# Revert all upstream changes
git checkout dev -- packages/opencode/src

# Keep only the plugin directory and build.ts changes
```

Then ensure all your customizations are in SOURCE_TRANSFORMS or shim files.
