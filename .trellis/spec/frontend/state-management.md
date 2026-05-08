# State Management

> Local state, global state, and server state patterns in this project.

---

## Overview

This project uses **SolidJS** reactive primitives for state management. State is organized into three categories:
1. **Local state** - Component-level state
2. **Global state** - Application-level state via contexts
3. **Server state** - Data from external sources

---

## Local State

### Simple State with createSignal

For single reactive values:

```typescript
import { createSignal } from "solid-js"

export function MyComponent() {
  const [collapsed, setCollapsed] = createSignal(false)
  const [count, setCount] = createSignal(0)

  return (
    <div>
      <button onClick={() => setCollapsed(!collapsed())}>
        {collapsed() ? "Expand" : "Collapse"}
      </button>
      <button onClick={() => setCount(count() + 1)}>
        Count: {count()}
      </button>
    </div>
  )
}
```

**Use when**: Simple boolean flags, counters, single values

**Example**: `packages/ui/src/components/message-part.tsx` (collapsed state)

### Complex State with createStore

For objects with multiple properties:

```typescript
import { createStore } from "solid-js/store"

export function QuestionPrompt() {
  const [store, setStore] = createStore({
    tab: 0,
    answers: [] as QuestionAnswer[],
    custom: [] as string[],
    editing: false,
  })

  // Update single property
  setStore("tab", 1)

  // Update nested property
  setStore("answers", 0, "value")

  // Update with function
  setStore("answers", (prev) => [...prev, newAnswer])

  return <div>{/* Use store */}</div>
}
```

**Use when**: Multiple related values, nested objects, arrays

**Example**: `packages/ui/src/components/message-part.tsx` (QuestionPrompt)

---

## Global State (Contexts)

### Context Pattern

This project uses a helper pattern for creating contexts:

```typescript
// context/data.tsx
import { createSimpleContext } from "./helper"

type Data = {
  session: Session[]
  message: { [sessionID: string]: Message[] }
  part: { [messageID: string]: Part[] }
}

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: {
    data: Data
    directory: string
    onPermissionRespond?: PermissionRespondFn
  }) => {
    return {
      get store() {
        return props.data
      },
      get directory() {
        return props.directory
      },
      respondToPermission: props.onPermissionRespond,
    }
  },
})
```

**Example**: `packages/ui/src/context/data.tsx`

### Using Contexts

```typescript
import { useData } from "../context"

export function MyComponent() {
  const data = useData()

  // Access store
  const sessions = data.store.session

  // Access methods
  data.respondToPermission?.({ ... })

  return <div>{/* Use data */}</div>
}
```

### Available Contexts

| Context | Purpose | Hook |
|---------|---------|------|
| Data | Application data (sessions, messages, parts) | `useData()` |
| Dialog | Dialog management | `useDialog()` |
| I18n | Internationalization | `useI18n()` |
| Diff | Diff component provider | `useDiffComponent()` |
| Code | Code component provider | `useCodeComponent()` |

**Location**: `packages/ui/src/context/`

---

## State Organization

### When to Use Local State

Use `createSignal` or `createStore` when:
- State is only used in one component
- State doesn't need to be shared
- State is UI-specific (collapsed, selected, etc.)

**Examples**:
- Collapsed/expanded state
- Form input values
- Tab selection
- Modal open/closed

### When to Use Context

Use context when:
- State needs to be shared across multiple components
- State is application-level
- State comes from external sources (props from parent app)

**Examples**:
- User data
- Session data
- Theme settings
- i18n translations

### Convention: Project Ownership Resolution

**What**: When a route directory must be mapped to a project, use the shared `projectOwner(directory, projects)` helper from `packages/app/src/pages/layout/helpers.ts`.

**Why**: Project rail selection, session list loading, child-store bootstrap, and project labels must agree on the same owner. A directory can temporarily appear both as a real project `worktree` and as stale `sandboxes` metadata on another project. Exact `worktree` matches must win before any sandbox match.

**Contract**:
- Input: `directory: string | undefined`, `projects: { worktree: string; sandboxes?: string[] }[]`.
- Output: `{ project, root, directory, sandbox } | undefined`.
- Rule: exact normalized `worktree` match first; only fall back to `sandboxes` when no project owns the directory as its `worktree`.
- Derived state: layout code should expose the active project as one object with `root` and `entry` fields, not as separate `currentProject()` and `currentProjectRoot()` memos.
- Debugging: log ignored stale sandbox ownership with `console.debug` so mismatched project metadata is observable.

**Good**:
```typescript
const owner = projectOwner(directory, layout.projects.list())
if (!owner) return
return { ...owner.project, root: owner.root, entry: owner.root }
```

**Bad**:
```typescript
return layout.projects.list().find((project) => project.worktree === directory || project.sandboxes?.includes(directory))
const currentProject = createMemo(() => activeProject()?.project)
const currentProjectRoot = createMemo(() => activeProject()?.root)
```

**Tests Required**:
- Exact worktree wins when another project also lists the same path as a sandbox.
- Sandbox ownership still works when no exact project worktree exists.
- Project rail selection receives the resolved owner root and only compares exact project roots.

### When to Use Props

Use props when:
- Parent component controls the state
- State flows down the component tree
- Component is controlled by parent

**Examples**:
- Controlled form inputs
- Callback functions
- Configuration options

---

## State Update Patterns

### Updating Signals

```typescript
const [count, setCount] = createSignal(0)

// Direct value
setCount(1)

// Function updater
setCount((prev) => prev + 1)
```

### Updating Stores

```typescript
const [store, setStore] = createStore({
  user: { name: "John", age: 30 },
  items: [1, 2, 3],
})

// Update single property
setStore("user", "name", "Jane")

// Update nested property
setStore("user", { name: "Jane", age: 31 })

// Update array
setStore("items", (prev) => [...prev, 4])

// Update array item
setStore("items", 0, 10)
```

### Batch Updates

SolidJS automatically batches updates:

```typescript
// These updates are batched
setCount(count() + 1)
setName("John")
setAge(30)
// Only one re-render
```

---

## Derived State

### Using createMemo

For computed values:

```typescript
import { createMemo } from "solid-js"

const [count, setCount] = createSignal(0)

// Derived value
const doubled = createMemo(() => count() * 2)

// Use in JSX
return <div>{doubled()}</div>
```

**Use when**: Expensive computation, derived from reactive values

### Using Functions

For simple derivations:

```typescript
const [firstName, setFirstName] = createSignal("John")
const [lastName, setLastName] = createSignal("Doe")

// Simple function
const fullName = () => `${firstName()} ${lastName()}`

// Use in JSX
return <div>{fullName()}</div>
```

**Use when**: Simple computation, not expensive

---

## State Persistence

### Local Storage

```typescript
import { createSignal, createEffect } from "solid-js"

export function useLocalStorage<T>(key: string, initialValue: T) {
  const stored = localStorage.getItem(key)
  const [value, setValue] = createSignal<T>(
    stored ? JSON.parse(stored) : initialValue
  )

  createEffect(() => {
    localStorage.setItem(key, JSON.stringify(value()))
  })

  return [value, setValue] as const
}
```

### Session Storage

Similar pattern with `sessionStorage`

---

## State Debugging

### Logging State Changes

```typescript
import { createEffect } from "solid-js"

const [count, setCount] = createSignal(0)

// Log changes
createEffect(() => {
  console.log("Count changed:", count())
})
```

### SolidJS DevTools

Use SolidJS DevTools browser extension for debugging

---

## Common Patterns

### Pattern 1: Toggle State

```typescript
const [open, setOpen] = createSignal(false)

const toggle = () => setOpen(!open())
```

### Pattern 2: Form State

```typescript
const [form, setForm] = createStore({
  name: "",
  email: "",
  age: 0,
})

const handleChange = (field: string, value: any) => {
  setForm(field, value)
}
```

### Pattern 3: List State

```typescript
const [items, setItems] = createSignal<string[]>([])

const addItem = (item: string) => {
  setItems([...items(), item])
}

const removeItem = (index: number) => {
  setItems(items().filter((_, i) => i !== index))
}
```

### Pattern 4: Async State

```typescript
const [data, setData] = createSignal<Data | null>(null)
const [loading, setLoading] = createSignal(false)
const [error, setError] = createSignal<Error | null>(null)

const fetchData = async () => {
  setLoading(true)
  setError(null)
  try {
    const result = await fetch("/api/data")
    setData(await result.json())
  } catch (e) {
    setError(e as Error)
  } finally {
    setLoading(false)
  }
}
```

---

## Anti-Patterns

### ❌ Don't

1. **Don't mutate state directly**
   ```typescript
   // Bad
   store.items.push(newItem)

   // Good
   setStore("items", [...store.items, newItem])
   ```

2. **Don't use createEffect for derived values**
   ```typescript
   // Bad
   const [doubled, setDoubled] = createSignal(0)
   createEffect(() => setDoubled(count() * 2))

   // Good
   const doubled = createMemo(() => count() * 2)
   ```

3. **Don't create signals in loops**
   ```typescript
   // Bad
   items.map(item => {
     const [selected, setSelected] = createSignal(false)
     return <div>{/* ... */}</div>
   })

   // Good - use store or single signal with array
   const [selected, setSelected] = createSignal<number[]>([])
   ```

4. **Don't forget to call signals**
   ```typescript
   // Bad
   if (count > 5) { ... }  // count is a function

   // Good
   if (count() > 5) { ... }
   ```

5. **Don't overuse context**
   ```typescript
   // Bad - context for component-local state
   const { collapsed, setCollapsed } = useCollapsedContext()

   // Good - local state
   const [collapsed, setCollapsed] = createSignal(false)
   ```

### ✅ Do

1. **Use createSignal for simple state**
   ```typescript
   const [count, setCount] = createSignal(0)
   ```

2. **Use createStore for complex state**
   ```typescript
   const [store, setStore] = createStore({ ... })
   ```

3. **Use createMemo for derived values**
   ```typescript
   const doubled = createMemo(() => count() * 2)
   ```

4. **Use context for shared state**
   ```typescript
   const data = useData()
   ```

5. **Keep state close to where it's used**
   ```typescript
   // Component-local state in component
   // Shared state in context
   ```

---

## Examples from Codebase

### Local State
- `packages/ui/src/components/message-part.tsx` (collapsed, expanded)

### Complex State
- `packages/ui/src/components/message-part.tsx` (QuestionPrompt store)

### Global State
- `packages/ui/src/context/data.tsx` (application data)
- `packages/ui/src/context/dialog.tsx` (dialog management)
- `packages/ui/src/context/i18n.tsx` (translations)

### Derived State
- `packages/ui/src/components/message-part.tsx` (computed values with createMemo)

---

## Key Takeaways

1. **createSignal** - Simple reactive values
2. **createStore** - Complex objects and arrays
3. **createMemo** - Derived values
4. **Context** - Shared application state
5. **Props** - Parent-controlled state
6. **Local first** - Keep state close to where it's used
7. **Immutable updates** - Never mutate state directly
8. **Call signals** - Always call signals to read values
9. **Batch updates** - SolidJS automatically batches
10. **DevTools** - Use SolidJS DevTools for debugging
