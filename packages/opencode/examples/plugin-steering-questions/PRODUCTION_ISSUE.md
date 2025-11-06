# CRITICAL: Production Does NOT Work with .tsx Files

## Test Results

**Status**: ❌ **FAILED**

Loading `.tsx` source files works in development (`bun dev`) but **CRASHES in production**.

### Error in Production Binary
```
Error: No renderer found
  at createElement
  at runComputation
  at updateComputation
  at devComponent
```

### Root Cause

The production binary is a **compiled Bun executable** created with `Bun.build({ compile: {...} })`.

1. **Main build**: JSX is transformed via `solidPlugin` during compilation
2. **Dynamic imports**: `.tsx` files imported at runtime are NOT transformed
3. **No JSX runtime**: The solid-js JSX runtime isn't available for runtime transformation

### Why Dev Works

In development (`bun dev`):
- Bun runtime handles JSX on-the-fly
- `tsconfig.json` with `jsxImportSource` works
- No compilation step needed

In production:
- Compiled executable can't transform JSX at runtime
- Dynamic imports of `.tsx` fail
- Solid-js renderer missing

---

## Solutions

### Option 1: Fix Plugin Build (RECOMMENDED)

Make the plugin build process actually work by resolving the `jsxDEV` import issue.

**Current problem**: Built `dist/index.js` has:
```javascript
import { jsxDEV } from "@opentui/solid/jsx-dev-runtime";
```
But this export doesn't exist.

**Potential fixes**:
1. Use production JSX transform (not dev)
2. Bundle solid-js completely (no externals)
3. Use a different build tool (esbuild, rollup)
4. Pre-compile during OpenCode's main build

### Option 2: Bundle Plugins with OpenCode

Include plugins in the main OpenCode build:

```typescript
// In script/build.ts
await Bun.build({
  entrypoints: [
    "./src/index.ts",
    "./examples/plugin-steering-questions/index.tsx",  // Add here
  ],
  plugins: [solidPlugin],  // Will transform JSX
  compile: { ... }
})
```

Pros:
- Guaranteed to work
- Plugins get solid transform

Cons:
- Can't dynamically load plugins
- Must rebuild OpenCode for new plugins
- Not extensible

### Option 3: Separate Plugin Runtime

Ship a plugin runtime that can handle JSX:

```bash
# Include bun runtime with OpenCode
dist/
  codesurf              # Main binary
  plugin-runtime        # Bun executable for plugins
```

Plugins run in separate process with JSX support.

Cons:
- Complex architecture
- IPC overhead
- More moving parts

---

## Recommended Action

**Fix the plugin build to produce working JavaScript.**

The issue is that `bunfig.toml` with `importSource = "solid-js"` creates imports for `jsxDEV` which don't exist. 

Try:
1. **Production mode**: Set `NODE_ENV=production` during build
2. **Use jsx() not jsxDEV()**: Production transform
3. **Bundle everything**: Remove all externals, bundle solid-js
4. **Different bundler**: Try esbuild with solid plugin

### Test Production Build
```typescript
// build.ts
const isDev = process.env.NODE_ENV !== 'production'

await build({
  entrypoints: ["index.tsx"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  minify: !isDev,
  external: isDev 
    ? ["@opencode-ai/sdk", "@opentui/solid", "@opentui/core"]
    : ["@opencode-ai/sdk"],  // Bundle solid in production
  // ... rest
})
```

---

## Current Workaround

**None for production.** The steering questions plugin currently ONLY works in development.

To make it production-ready:
1. Fix the build (jsxDEV import issue)
2. Verify built .js file imports successfully
3. Update config to use dist/index.js
4. Test in production binary

---

## Alternative: Server-Side Rendering

Since this is a TUI (terminal UI), consider:
1. Pre-render the form structure
2. Use plain text/ANSI art
3. Avoid JSX entirely for simple widgets

Example:
```typescript
// No JSX needed
const widget = {
  render: (config) => {
    const lines = [
      `Title: ${config.title}`,
      ``,
      ...config.questions.map(q => `[ ] ${q.label}`)
    ]
    return lines.join('\n')
  }
}
```

But this loses interactivity and solid-js reactivity.
