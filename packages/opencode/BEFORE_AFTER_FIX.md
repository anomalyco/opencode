# Before vs After: Plugin Rendering Fix

## Before (BROKEN ❌)

```tsx
// In PluginComponent.tsx
return (
  <Show when={ComponentFn()}>
    {ComponentFn()!()}  // ❌ Function call - breaks context
  </Show>
)
```

**Result:**
```
TUI Renderer Context
  ↓
PluginComponent (in context)
  ↓
ComponentFn()  ❌ CALLED AS FUNCTION - NO CONTEXT!
  ↓
<VStack>  ❌ ERROR: No renderer found
```

**Error:**
```
Error: No renderer found when creating <box> element
```

---

## After (WORKING ✅)

```tsx
// In PluginComponent.tsx
return (
  <Show when={ComponentFn()}>
    {(() => {
      const Component = ComponentFn()!
      return <Component />  // ✅ JSX render - preserves context
    })()}
  </Show>
)
```

**Result:**
```
TUI Renderer Context
  ↓
PluginComponent (in context)
  ↓
<Component />  ✅ RENDERED AS JSX - CONTEXT PRESERVED!
  ↓
<VStack>  ✅ Has renderer context
  ↓
<box>  ✅ Renders successfully
```

**Success:**
```
✓ Plugin Panel Working
Count: 0 → 1 → 2
one two three
```

---

## Key Difference

### Function Call (❌)
```tsx
ComponentFn()()
```
- Executes outside render tree
- Breaks context chain
- Canvas components have no renderer
- **FAILS**

### JSX Render (✅)
```tsx
<Component />
```
- Renders within tree
- Maintains context chain
- Canvas components access renderer
- **WORKS**

---

## The Technical Why

SolidJS uses a **render context** that flows through the component tree. This context is established when components are rendered **as JSX**.

When you call a component as a function:
1. It executes **outside** the current render context
2. Child components can't access parent context
3. Canvas components fail because they need TUI renderer context

When you render as JSX:
1. SolidJS wraps it in the render tree
2. Context flows down to children
3. Canvas components access TUI renderer
4. Everything works!

---

## Code Comparison

### Before
```tsx
{ComponentFn()!()}
```
This is equivalent to:
```tsx
const fn = ComponentFn()
const result = fn()  // Executes outside context
return result
```

### After
```tsx
{(() => {
  const Component = ComponentFn()!
  return <Component />  // Renders in context
})()}
```
This is equivalent to:
```tsx
const Component = ComponentFn()
return createElement(Component, {})  // SolidJS render
```

The `createElement` call (what JSX compiles to) is what establishes the context chain!

---

## Lesson Learned

**Always render SolidJS components as JSX, never call them as functions.**

```tsx
// ❌ WRONG
{Component()}
{component()}
{getComponent()()}

// ✅ CORRECT
<Component />
<component />
{(() => {
  const Comp = getComponent()
  return <Comp />
})()}
```

This applies to:
- Dynamic components
- Components from props
- Components from signals
- Components from functions

**When in doubt: JSX it out!** 🎨
