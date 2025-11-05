# Plugin Rendering Fix - November 5, 2025

## Problem

Plugins using the Canvas components failed with "No renderer found" errors, even though:

- Canvas components worked perfectly when tested independently ✅
- Plugins returned component functions (not JSX) ✅
- PluginComponent was in the sidebar render tree ✅

## Root Cause

In `src/cli/cmd/tui/component/plugin-component.tsx`, the plugin component was being called as a plain function instead of being rendered as JSX:

```tsx
// WRONG - Calls function outside render context
{
  ComponentFn()!()
}
```

This executed the component function **outside the SolidJS render tree**, causing Canvas components inside to fail because they had no renderer context.

## Solution

Changed the rendering to call the component **as JSX within the render tree**:

```tsx
// CORRECT - Renders component as JSX
{
  ;(() => {
    const Component = ComponentFn()!
    return <Component />
  })()
}
```

This creates a proper SolidJS component call that:

1. Gets the component function from the signal
2. Calls it **as JSX** using `<Component />`
3. Executes within an IIFE in the render tree
4. Preserves the renderer context for all child Canvas components

## Files Changed

- `src/cli/cmd/tui/component/plugin-component.tsx` - Fixed component rendering (lines 74-77)

## Verification

Created test in `test-plugin-component.tsx` that confirms:

- ✅ Plugin components render without errors
- ✅ Canvas components work inside plugins
- ✅ Signals and reactivity function correctly
- ✅ Component lifecycle hooks (onMount, onCleanup) work

## Key Insight

**SolidJS components must be called as JSX (`<Component />`) not as functions (`Component()`)** to maintain the renderer context chain. The Canvas wrapper components depend on this context to render properly.

## Testing

```bash
# Test the fix
bun test-plugin-component.tsx

# Expected output:
# Loading plugin...
# ✓ Plugin component works!
# Count: 0 → 1
```

## Next Steps

Plugins can now safely use Canvas components (`VStack`, `HStack`, `Text`, `Box`) from `src/plugin-ui` without worrying about renderer context issues.
