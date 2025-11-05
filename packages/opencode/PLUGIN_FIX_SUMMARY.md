# Plugin System Fix - Complete Summary

**Date:** November 5, 2025  
**Issue:** Plugins failed with "No renderer found" errors  
**Status:** ✅ RESOLVED

---

## The Journey

### Initial Problem

Plugins configured in `opencode.json` would load but fail to render with:

```
Error: No renderer found when creating <box> element
```

### What We Discovered

1. **Plugin Loading Issues**
   - Relative paths didn't work → Fixed with `file://` URLs
   - Bun's bundler transforms JSX differently than SolidJS expects
   - Loading `.tsx` files directly worked better than bundled versions

2. **Signal Passing Issue**
   - Plugin received unwrapped signal value instead of signal function
   - Fixed in `sidebar.tsx` by passing `session` instead of `session()`

3. **The Real Problem: Renderer Context**
   - Even with correct signal passing, plugins still failed
   - Canvas components worked perfectly in isolation ✅
   - Failed only when called through `PluginComponent`

### Root Cause

In `src/cli/cmd/tui/component/plugin-component.tsx`, the component was called as a **plain function**:

```tsx
// WRONG - Executes outside render tree
{
  ComponentFn()!()
}
```

This executed the plugin component **outside the SolidJS render context**, causing all Canvas components inside to fail because they had no access to the TUI renderer.

### The Fix

Changed to call the component **as JSX within the render tree**:

```tsx
// CORRECT - Renders as JSX in render tree
{
  ;(() => {
    const Component = ComponentFn()!
    return <Component />
  })()
}
```

**Why this works:**

1. Gets component function from signal
2. Calls it as JSX (`<Component />`) not function (`Component()`)
3. Executes in IIFE within render tree
4. Preserves renderer context for all children

---

## What Changed

### Files Modified

1. **`src/cli/cmd/tui/component/plugin-component.tsx`**
   - Fixed component rendering (lines 74-77)
   - Added type import for `Component`

2. **`examples/plugin-sidebar-context/index.tsx`**
   - Removed unused `Show` import
   - Fixed unused parameter warning

### Files Created

1. **`src/plugin-ui/canvas.tsx`** (from previous session)
   - Wrapper components: VStack, HStack, Text, Box
   - Work within TUI renderer context

2. **`src/plugin-ui/index.ts`** (from previous session)
   - Public API exports for plugin developers

3. **`test-plugin-component.tsx`** (new)
   - Basic test of plugin component rendering

4. **`test-real-plugin-scenario.tsx`** (new)
   - Comprehensive test mimicking real plugin usage
   - Tests signals, lifecycle hooks, Canvas components, For loops

5. **`PLUGIN_RENDERING_FIX.md`** (new)
   - Technical documentation of the fix

---

## Verification

All tests pass:

### Canvas Components Test

```bash
bun test-canvas-components.tsx
```

✅ VStack, HStack, Text render correctly  
✅ Signals work  
✅ For loops work  
✅ Complete components work

### Plugin Component Test

```bash
bun test-plugin-component.tsx
```

✅ Plugin components render without errors  
✅ Canvas components work inside plugins  
✅ Loading state works correctly

### Real Plugin Scenario Test

```bash
bun test-real-plugin-scenario.tsx
```

✅ Complete plugin lifecycle works  
✅ onMount/onCleanup hooks execute  
✅ Signals update reactively  
✅ For loops render items  
✅ Canvas components display correctly

---

## For Plugin Developers

### Use Canvas Components

Import from `src/plugin-ui`:

```tsx
import {
  createSignal,
  onMount,
  onCleanup,
  For,
  VStack,
  HStack,
  Text,
  Box,
} from "../../src/plugin-ui"
```

### Component Structure

```tsx
export const MyPlugin = async () => {
  return {
    "ui.register": async (_input: any, output: any) => {
      output.panels = [
        {
          id: "my-panel",
          label: "My Panel",
          // ... config
        },
      ]
    },

    "ui.render": async (input: any, output: any) => {
      if (input.componentId === "my-panel") {
        const MyPanel = () => {
          const [data, setData] = createSignal({ value: 0 })

          onMount(() => {
            // Setup code
            onCleanup(() => {
              // Cleanup code
            })
          })

          return (
            <VStack gap={0}>
              <Text fg="#00ff00">Hello from plugin!</Text>
              <Text fg="#6b7280">Value: {data().value}</Text>
            </VStack>
          )
        }

        // Return function, NOT JSX
        output.component = MyPanel
        output.type = "component"
      }
    },
  }
}
```

### Key Rules

1. **Return component function**, not JSX
2. **Use only Canvas components** (VStack, HStack, Text, Box)
3. **Load as `.tsx`** files with `file://` URLs
4. **Don't call components** - let PluginComponent handle it

---

## Technical Insight

### Why Component vs Function Call Matters

SolidJS uses a render tree with context that flows down through components. When you call a component as a function:

```tsx
Component() // ❌ Breaks context chain
```

It executes **outside** the context chain. Child components can't access renderer context.

When you render as JSX:

```tsx
<Component /> // ✅ Maintains context chain
```

SolidJS properly wraps it in the render tree, preserving context for all children.

### The Context Chain

```
TUI Renderer (provides context)
  ↓
PluginComponent (in render tree)
  ↓
<Plugin Component /> (properly rendered)
  ↓
Canvas Components (access context)
  ↓
OpenTUI elements (render to terminal)
```

If we break the chain by calling the plugin component as a function, Canvas components can't access the renderer context and fail.

---

## Next Steps

1. ✅ Plugin rendering works
2. ✅ Canvas components stable
3. ✅ Tests verify functionality
4. 🎯 Plugins ready for production use

Developers can now create sidebar panels, tabs, and UI components using the Canvas API without worrying about renderer context issues.

---

## Files Reference

- `src/cli/cmd/tui/component/plugin-component.tsx` - Plugin loader
- `src/plugin-ui/canvas.tsx` - Canvas wrapper components
- `src/plugin-ui/index.ts` - Public API
- `examples/plugin-sidebar-context/index.tsx` - Example plugin
- `opencode.json` - Plugin configuration
