# Hook Guidelines

> Custom hooks, data fetching patterns, and reactive primitives in this project.

---

## Overview

This project uses **SolidJS** reactive primitives. Unlike React hooks, SolidJS primitives don't have rules about where they can be called - they're just functions that create reactive values.

---

## Hook Naming Conventions

### Naming Patterns

1. **`create*`** - Hook factories that return reactive values
   - `createSignal()` - Built-in SolidJS primitive
   - `createMemo()` - Built-in SolidJS primitive
   - `createAutoScroll()` - Custom hook factory

2. **`use*`** - React-style hooks (context consumers)
   - `useData()` - Context consumer
   - `useDialog()` - Context consumer
   - `useI18n()` - Context consumer

### Examples from Codebase

```typescript
// Hook factory (create*)
export function createAutoScroll(options: AutoScrollOptions) { ... }

// Context consumer (use*)
export const { use: useData, provider: DataProvider } = createSimpleContext({ ... })
```

---

## Hook Structure

### Basic Hook Pattern

```typescript
// create-auto-scroll.tsx
import { createEffect, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"

export interface AutoScrollOptions {
  working: () => boolean
  onUserInteracted?: () => void
  overflowAnchor?: "none" | "auto" | "dynamic"
  bottomThreshold?: number
}

export function createAutoScroll(options: AutoScrollOptions) {
  // Local variables
  let scroll: HTMLElement | undefined
  let settling = false

  // Reactive state
  const [store, setStore] = createStore({
    contentRef: undefined as HTMLElement | undefined,
    userScrolled: false,
  })

  // Computed values
  const active = () => options.working() || settling

  // Effects
  createEffect(on(options.working, (working: boolean) => {
    // Effect logic
  }))

  // Cleanup
  onCleanup(() => {
    // Cleanup logic
  })

  // Return API
  return {
    scrollRef: (el: HTMLElement | undefined) => { ... },
    contentRef: (el: HTMLElement | undefined) => { ... },
    handleScroll,
    pause: stop,
    resume: () => { ... },
  }
}
```

**Example**: `packages/ui/src/hooks/create-auto-scroll.tsx`

### Key Elements

1. **Options interface** - Typed configuration
2. **Local variables** - Non-reactive state (let/const)
3. **Reactive state** - createSignal/createStore
4. **Computed values** - Functions that read reactive state
5. **Effects** - createEffect for side effects
6. **Cleanup** - onCleanup for resource cleanup
7. **Return API** - Object with methods and refs

---

## Reactive Primitives

### createSignal

For simple reactive values:

```typescript
import { createSignal } from "solid-js"

const [collapsed, setCollapsed] = createSignal(false)

// Read
console.log(collapsed())

// Write
setCollapsed(true)
```

**Use when**: Single value that changes over time

### createStore

For complex reactive objects:

```typescript
import { createStore } from "solid-js/store"

const [store, setStore] = createStore({
  tab: 0,
  answers: [] as string[],
  editing: false,
})

// Read
console.log(store.tab)

// Write
setStore("tab", 1)
setStore("answers", [...store.answers, "new"])
```

**Use when**: Multiple related values, nested objects, arrays

**Example**: `packages/ui/src/components/message-part.tsx` (QuestionPrompt)

### createMemo

For derived values:

```typescript
import { createMemo } from "solid-js"

const doubled = createMemo(() => count() * 2)
```

**Use when**: Expensive computation that depends on reactive values

### createEffect

For side effects:

```typescript
import { createEffect, on } from "solid-js"

// Run on any dependency change
createEffect(() => {
  console.log(count())
})

// Run only when specific value changes
createEffect(on(count, (value) => {
  console.log(value)
}))
```

**Use when**: Side effects (DOM manipulation, logging, etc.)

---

## Hook Patterns

### Pattern 1: Ref Management Hook

Hook that manages element refs and event listeners:

```typescript
export function createAutoScroll(options: AutoScrollOptions) {
  let scroll: HTMLElement | undefined
  let cleanup: (() => void) | undefined

  const scrollRef = (el: HTMLElement | undefined) => {
    if (cleanup) {
      cleanup()
      cleanup = undefined
    }

    scroll = el

    if (!el) return

    el.addEventListener("wheel", handleWheel, { passive: true })

    cleanup = () => {
      el.removeEventListener("wheel", handleWheel)
    }
  }

  onCleanup(() => {
    if (cleanup) cleanup()
  })

  return { scrollRef }
}
```

**Example**: `packages/ui/src/hooks/create-auto-scroll.tsx`

### Pattern 2: Filtered List Hook

Hook that manages list filtering:

```typescript
export function useFilteredList<T>(
  items: () => T[],
  filter: (item: T) => boolean
) {
  return createMemo(() => items().filter(filter))
}
```

**Example**: `packages/ui/src/hooks/use-filtered-list.tsx`

### Pattern 3: Resize Observer Hook

Using external primitives:

```typescript
import { createResizeObserver } from "@solid-primitives/resize-observer"

export function createAutoScroll(options: AutoScrollOptions) {
  const [store, setStore] = createStore({
    contentRef: undefined as HTMLElement | undefined,
  })

  createResizeObserver(
    () => store.contentRef,
    () => {
      // Handle resize
    }
  )

  return {
    contentRef: (el: HTMLElement | undefined) => setStore("contentRef", el)
  }
}
```

**Example**: `packages/ui/src/hooks/create-auto-scroll.tsx`

---

## Context Hooks

### Context Pattern

Contexts use a helper pattern:

```typescript
// context/data.tsx
import { createSimpleContext } from "./helper"

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: { data: Data; directory: string }) => {
    return {
      get store() {
        return props.data
      },
      get directory() {
        return props.directory
      },
    }
  },
})
```

**Usage**:
```typescript
// In component
const data = useData()
console.log(data.store)
console.log(data.directory)
```

**Example**: `packages/ui/src/context/data.tsx`

---

## Hook Composition

### Composing Multiple Hooks

```typescript
export function MyComponent() {
  const data = useData()
  const dialog = useDialog()
  const i18n = useI18n()

  const autoScroll = createAutoScroll({
    working: () => true,
    overflowAnchor: "auto",
  })

  return (
    <div ref={autoScroll.scrollRef} onScroll={autoScroll.handleScroll}>
      {/* Content */}
    </div>
  )
}
```

---

## Effect Patterns

### Effect with Cleanup

```typescript
createEffect(() => {
  const timer = setTimeout(() => {
    // Do something
  }, 1000)

  onCleanup(() => clearTimeout(timer))
})
```

### Effect with Explicit Dependencies

```typescript
import { on } from "solid-js"

createEffect(on(
  options.working,
  (working: boolean) => {
    if (working) {
      // Start
    } else {
      // Stop
    }
  }
))
```

**Example**: `packages/ui/src/hooks/create-auto-scroll.tsx`

---

## Common Patterns

### Pattern: Throttled Value

```typescript
function createThrottledValue(getValue: () => string) {
  const [value, setValue] = createSignal(getValue())
  let timeout: ReturnType<typeof setTimeout> | undefined
  let last = 0

  createEffect(() => {
    const next = getValue()
    const now = Date.now()
    const remaining = THROTTLE_MS - (now - last)

    if (remaining <= 0) {
      if (timeout) {
        clearTimeout(timeout)
        timeout = undefined
      }
      last = now
      setValue(next)
      return
    }

    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => {
      last = Date.now()
      setValue(next)
      timeout = undefined
    }, remaining)
  })

  onCleanup(() => {
    if (timeout) clearTimeout(timeout)
  })

  return value
}
```

**Example**: `packages/ui/src/components/message-part.tsx`

---

## Anti-Patterns

### ❌ Don't

1. **Don't call hooks conditionally** (not a SolidJS rule, but good practice)
   ```typescript
   // Bad
   if (condition) {
     const [signal, setSignal] = createSignal(0)
   }
   ```

2. **Don't forget cleanup**
   ```typescript
   // Bad
   createEffect(() => {
     const timer = setInterval(() => { ... }, 1000)
     // Missing cleanup!
   })

   // Good
   createEffect(() => {
     const timer = setInterval(() => { ... }, 1000)
     onCleanup(() => clearInterval(timer))
   })
   ```

3. **Don't use createEffect for derived values**
   ```typescript
   // Bad
   const [doubled, setDoubled] = createSignal(0)
   createEffect(() => setDoubled(count() * 2))

   // Good
   const doubled = createMemo(() => count() * 2)
   ```

4. **Don't mutate store directly**
   ```typescript
   // Bad
   store.tab = 1

   // Good
   setStore("tab", 1)
   ```

5. **Don't forget to call signals**
   ```typescript
   // Bad
   console.log(count)  // Function, not value

   // Good
   console.log(count())  // Value
   ```

### ✅ Do

1. **Use createMemo for derived values**
   ```typescript
   const doubled = createMemo(() => count() * 2)
   ```

2. **Use onCleanup for cleanup**
   ```typescript
   createEffect(() => {
     const timer = setTimeout(() => { ... }, 1000)
     onCleanup(() => clearTimeout(timer))
   })
   ```

3. **Use createStore for complex state**
   ```typescript
   const [store, setStore] = createStore({ ... })
   ```

4. **Export hook options interface**
   ```typescript
   export interface AutoScrollOptions { ... }
   export function createAutoScroll(options: AutoScrollOptions) { ... }
   ```

5. **Return stable API from hooks**
   ```typescript
   return {
     scrollRef,
     handleScroll,
     pause,
     resume,
   }
   ```

---

## Examples from Codebase

### Hook Factory
- `packages/ui/src/hooks/create-auto-scroll.tsx`

### Context Hook
- `packages/ui/src/context/data.tsx`
- `packages/ui/src/context/dialog.tsx`
- `packages/ui/src/context/i18n.tsx`

### Filtered List Hook
- `packages/ui/src/hooks/use-filtered-list.tsx`

---

## Key Takeaways

1. **`create*` for factories** - Hook factories return reactive values
2. **`use*` for contexts** - Context consumers
3. **createSignal** - Simple reactive values
4. **createStore** - Complex reactive objects
5. **createMemo** - Derived values
6. **createEffect** - Side effects
7. **onCleanup** - Always cleanup resources
8. **Export interfaces** - Type hook options
9. **Stable API** - Return consistent object shape
10. **No rules** - SolidJS primitives can be called anywhere
