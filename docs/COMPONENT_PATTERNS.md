# Solid.js Component Patterns

**Last Updated:** 2026-01-15

This document details the Solid.js component and context patterns used in the OpenWork codebase.

## Table of Contents

- [Component Structure](#component-structure)
- [Context/Provider Pattern](#contextprovider-pattern)
- [State Patterns](#state-patterns)
- [Reactivity Patterns](#reactivity-patterns)
- [Component Communication](#component-communication)
- [Common UI Patterns](#common-ui-patterns)
- [Performance Patterns](#performance-patterns)

---

## Component Structure

### Basic Component Template
```typescript
import { createSignal, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import type { MyComponentProps } from "@/types/my-component"

export interface MyComponentProps {
  name: string
  value?: number
  class?: string
  onValueChange?: (value: number) => void
  children?: any
}

export function MyComponent(props: MyComponentProps) {
  const [isActive, setIsActive] = createSignal(false)

  const handleClick = () => {
    setIsActive(true)
    props.onValueChange?.(42)
  }

  return (
    <div class={`my-component ${props.class ?? ""}`}>
      <Show when={isActive()}>
        <span>{props.name}</span>
      </Show>
      <Button onClick={handleClick}>
        Click me
      </Button>
      {props.children}
    </div>
  )
}
```

### Props Forwarding with splitProps
```typescript
import { splitProps, JSX } from "solid-js"

interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary"
  size?: "small" | "medium" | "large"
}

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["variant", "size", "class", "children"])

  return (
    <button
      {...rest}
      class={`btn btn-${local.variant ?? "primary"} btn-${local.size ?? "medium"} ${local.class ?? ""}`}
    >
      {local.children}
    </button>
  )
}
```

---

## Context/Provider Pattern

### The `createSimpleContext` Helper

The codebase uses a custom helper located at `packages/ui/src/context/helper.tsx`:

```typescript
// Actual implementation from packages/ui/src/context/helper.tsx
export function createSimpleContext<T, Props extends Record<string, any>>(input: {
  name: string
  init: ((input: Props) => T) | (() => T)
  gate?: boolean  // If true, waits for `ready()` before rendering children
}) {
  const ctx = createContext<T>()

  return {
    provider: (props: ParentProps<Props>) => {
      const init = input.init(props)
      const gate = input.gate ?? true

      if (!gate) {
        return <ctx.Provider value={init}>{props.children}</ctx.Provider>
      }

      // Access init.ready inside memo for reactivity
      const isReady = createMemo(() => {
        const ready = init.ready as Accessor<boolean> | boolean | undefined
        return ready === undefined || (typeof ready === "function" ? ready() : ready)
      })

      return (
        <Show when={isReady()}>
          <ctx.Provider value={init}>{props.children}</ctx.Provider>
        </Show>
      )
    },
    use() {
      const value = useContext(ctx)
      if (!value) throw new Error(`${input.name} context must be used within a provider`)
      return value
    },
  }
}
```

### Using `createSimpleContext`
The codebase uses this helper for creating contexts:

```typescript
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createStore } from "solid-js/store"
import { createSignal, batch, onCleanup } from "solid-js"

// Define the context API interface
interface McpConnectorsAPI {
  config: () => McpConfig
  isLoading: () => boolean
  addServer: (name: string, server: McpServer) => Promise<OperationResult>
  removeServer: (name: string) => Promise<OperationResult>
  updateServer: (name: string, server: McpServer) => Promise<OperationResult>
}

// Create context with provider and hook
export const { use: useMcpConnectors, provider: McpConnectorsProvider } = createSimpleContext({
  name: "McpConnectors",
  gate: false,  // Optional: wait for ready state
  init: () => {
    // Initialize state
    const [config, setConfig] = createStore<McpConfig>(DEFAULT_CONFIG)
    const [isLoading, setIsLoading] = createSignal(false)

    // Define methods
    async function addServer(name: string, server: McpServer): Promise<OperationResult> {
      setIsLoading(true)
      try {
        // Implementation
        setConfig("mcpServers", name, server)
        return { success: true }
      } finally {
        setIsLoading(false)
      }
    }

    // Return public API
    return {
      config: () => config,
      isLoading,
      addServer,
      removeServer,
      updateServer,
    }
  },
})
```

### Provider Usage
```typescript
// App.tsx
import { McpConnectorsProvider } from "@/context/mcp-connectors"
import { LayoutProvider } from "@/context/layout"

export function App() {
  return (
    <LayoutProvider>
      <McpConnectorsProvider>
        <MainContent />
      </McpConnectorsProvider>
    </LayoutProvider>
  )
}
```

### Hook Usage
```typescript
// MyComponent.tsx
import { useMcpConnectors } from "@/context/mcp-connectors"

export function MyComponent() {
  const mcp = useMcpConnectors()

  const handleAdd = async () => {
    const result = await mcp.addServer("my-server", { command: "node server.js" })
    if (result.success) {
      console.log("Server added!")
    }
  }

  return (
    <Show when={!mcp.isLoading()}>
      <button onClick={handleAdd}>Add Server</button>
    </Show>
  )
}
```

### Context with Gated Loading
For contexts that need to load data before rendering:

```typescript
export const { use: useLayout, provider: LayoutProvider } = createSimpleContext({
  name: "Layout",
  gate: true,  // Wait for ready() before rendering children
  init: () => {
    const [store, setStore, _, ready] = persisted(
      Persist.global("layout", ["layout.v8"]),
      createStore(DEFAULT_LAYOUT)
    )

    return {
      store: () => store,
      setStore,
      ready,  // Must return ready accessor when gate: true
    }
  },
})
```

---

## State Patterns

### Simple State with createSignal
```typescript
const [count, setCount] = createSignal(0)
const [selectedFile, setSelectedFile] = createSignal<LocalFile | null>(null)
const [isOpen, setIsOpen] = createSignal(false)

// Update
setCount(count() + 1)
setCount(prev => prev + 1)
setSelectedFile(file)
setIsOpen(true)
```

### Object State with createStore
```typescript
interface LayoutState {
  sidebar: { opened: boolean; width: number }
  terminal: { height: number }
  review: { diffStyle: "unified" | "split" }
}

const [store, setStore] = createStore<LayoutState>({
  sidebar: { opened: true, width: 280 },
  terminal: { height: 200 },
  review: { diffStyle: "unified" },
})

// Path-based updates
setStore("sidebar", "opened", true)
setStore("sidebar", "width", 320)

// Nested path updates
setStore("review", "diffStyle", "split")

// Using produce for complex updates
import { produce } from "solid-js/store"

setStore(produce((draft) => {
  draft.sidebar.opened = true
  draft.sidebar.width = 320
}))
```

### Persisted State Pattern
```typescript
import { persisted, Persist } from "@/utils/persist"

// Global persistence (app-wide settings)
const [store, setStore, _, ready] = persisted(
  Persist.global("layout", ["layout.v7", "layout.v6"]),  // Legacy keys for migration
  createStore(DEFAULT_STATE)
)

// Workspace persistence (per-project settings)
const [store, setStore, _, ready] = persisted(
  Persist.workspace(directory, "workspace-settings"),
  createStore(DEFAULT_STATE)
)

// Session persistence (per-session settings)
const [store, setStore, _, ready] = persisted(
  Persist.session(directory, sessionId, "session-state"),
  createStore(DEFAULT_STATE)
)
```

---

## Reactivity Patterns

### Computed Values with createMemo
```typescript
// Simple memo
const sortedFiles = createMemo(() => {
  return [...files()].sort((a, b) => b.timestamp - a.timestamp)
})

// Memo with dependencies
const filteredItems = createMemo(() => {
  const query = searchQuery()
  const items = allItems()
  if (!query) return items
  return items.filter(item => item.name.includes(query))
})

// Nested memo for expensive operations
const enrichedData = createMemo(() => {
  return rawData().map(item => ({
    ...item,
    computed: expensiveComputation(item)
  }))
})

const visibleData = createMemo(() => {
  return enrichedData().slice(0, pageSize())
})
```

### Side Effects with createEffect
```typescript
// Basic effect
createEffect(() => {
  const file = selectedFile()
  if (file) {
    console.log("Selected:", file.name)
  }
})

// Effect with cleanup
createEffect(() => {
  const socket = connectWebSocket(url())

  onCleanup(() => {
    socket.close()
  })
})

// Effect with on() for explicit dependencies
import { on } from "solid-js"

createEffect(on(selectedFile, (file, prevFile) => {
  if (file && file !== prevFile) {
    loadFileContent(file.path)
  }
}))
```

### Event Subscriptions
```typescript
import { onCleanup, onMount } from "solid-js"

export function MyComponent() {
  onMount(() => {
    const handleResize = () => {
      // Handle window resize
    }

    window.addEventListener("resize", handleResize)
    onCleanup(() => {
      window.removeEventListener("resize", handleResize)
    })
  })

  // SDK event subscription
  const sdk = useSdk()

  createEffect(() => {
    const unsubscribe = sdk.event.on("session.updated", (event) => {
      // Handle event
    })

    onCleanup(unsubscribe)
  })
}
```

### Batch Updates
```typescript
import { batch } from "solid-js"

// Batch multiple state updates
batch(() => {
  setCount(count() + 1)
  setIsLoading(false)
  setError(null)
})

// With stores
batch(() => {
  setStore("sidebar", "opened", true)
  setStore("sidebar", "width", 320)
})
```

---

## Component Communication

### Props Callbacks
```typescript
interface FileTreeProps {
  files: LocalFile[]
  selectedPath?: string
  onFileClick?: (file: LocalFile) => void
  onFileDoubleClick?: (file: LocalFile) => void
}

export function FileTree(props: FileTreeProps) {
  const handleClick = (file: LocalFile) => {
    props.onFileClick?.(file)
  }

  const handleDoubleClick = (file: LocalFile) => {
    props.onFileDoubleClick?.(file)
  }

  return (
    <For each={props.files}>
      {(file) => (
        <FileTreeItem
          file={file}
          selected={props.selectedPath === file.path}
          onClick={() => handleClick(file)}
          onDoubleClick={() => handleDoubleClick(file)}
        />
      )}
    </For>
  )
}
```

### Context for Cross-Component State
```typescript
// Parent component provides context
function Workspace() {
  return (
    <FileActivityProvider>
      <Sidebar />
      <MainPanel />
      <StatusBar />
    </FileActivityProvider>
  )
}

// Any descendant can access
function Sidebar() {
  const fileActivity = useFileActivity()

  return (
    <div>
      <span>Active files: {fileActivity.count()}</span>
    </div>
  )
}
```

### Dialog Pattern
```typescript
import { useDialog } from "@opencode-ai/ui/dialog"

export function MyComponent() {
  const dialog = useDialog()

  const openSettings = () => {
    dialog.show(
      () => <SettingsForm />,
      () => {
        // onClose callback
        console.log("Dialog closed")
      }
    )
  }

  return <button onClick={openSettings}>Settings</button>
}
```

---

## Common UI Patterns

### Conditional Rendering
```tsx
// Simple conditional
<Show when={isVisible()}>
  <Content />
</Show>

// With fallback
<Show when={data()} fallback={<Loading />}>
  {(data) => <DataDisplay data={data()} />}
</Show>

// Multiple conditions
<Switch>
  <Match when={status() === "loading"}>
    <LoadingSpinner />
  </Match>
  <Match when={status() === "error"}>
    <ErrorMessage error={error()} />
  </Match>
  <Match when={status() === "success"}>
    <SuccessContent />
  </Match>
</Switch>
```

### List Rendering
```tsx
// Simple list
<For each={items()}>
  {(item) => <ListItem item={item} />}
</For>

// With index
<For each={items()}>
  {(item, index) => (
    <ListItem
      item={item}
      index={index()}
      isFirst={index() === 0}
      isLast={index() === items().length - 1}
    />
  )}
</For>

// Keyed list (when items can change order)
<Index each={items()}>
  {(item, index) => <ListItem item={item()} index={index} />}
</Index>
```

### Dynamic Components
```tsx
import { Dynamic } from "solid-js/web"

const iconComponents = {
  file: FileIcon,
  folder: FolderIcon,
  image: ImageIcon,
}

function IconDisplay(props: { type: keyof typeof iconComponents }) {
  return <Dynamic component={iconComponents[props.type]} />
}
```

### Portal for Overlays
```tsx
import { Portal } from "solid-js/web"

function Modal(props: { isOpen: boolean; children: any }) {
  return (
    <Show when={props.isOpen}>
      <Portal>
        <div class="modal-overlay">
          <div class="modal-content">
            {props.children}
          </div>
        </div>
      </Portal>
    </Show>
  )
}
```

---

## Performance Patterns

### Lazy Loading
```typescript
import { lazy } from "solid-js"

const HeavyComponent = lazy(() => import("./HeavyComponent"))

function App() {
  return (
    <Suspense fallback={<Loading />}>
      <HeavyComponent />
    </Suspense>
  )
}
```

### Deferred Updates
```typescript
import { createDeferred } from "solid-js"

// Defer expensive computation
const deferredValue = createDeferred(() => expensiveComputation(input()), {
  timeoutMs: 100
})
```

### Untracked Access
```typescript
import { untrack } from "solid-js"

createEffect(() => {
  const current = selectedFile()

  // Don't track changes to allFiles
  const files = untrack(() => allFiles())

  // Only re-run when selectedFile changes
  const found = files.find(f => f.path === current?.path)
})
```

### Session-Scoped Reactivity
For managing state across multiple sessions:

```typescript
import { createRoot } from "solid-js"

interface SessionState {
  files: Map<string, FileState>
  dispose: () => void
}

const sessionCache = new Map<string, SessionState>()

function getOrCreateSession(sessionId: string): SessionState {
  if (sessionCache.has(sessionId)) {
    return sessionCache.get(sessionId)!
  }

  // Create independent reactivity scope
  const state = createRoot((dispose) => {
    const [files, setFiles] = createStore(new Map())

    return {
      files,
      setFiles,
      dispose
    }
  })

  sessionCache.set(sessionId, state)
  return state
}

// Cleanup when session ends
function disposeSession(sessionId: string) {
  const session = sessionCache.get(sessionId)
  if (session) {
    session.dispose()
    sessionCache.delete(sessionId)
  }
}
```

### LRU Cache for Sessions
```typescript
const MAX_SESSIONS = 10
const sessionOrder: string[] = []

function accessSession(sessionId: string) {
  // Move to end of order
  const index = sessionOrder.indexOf(sessionId)
  if (index > -1) {
    sessionOrder.splice(index, 1)
  }
  sessionOrder.push(sessionId)

  // Evict oldest if over limit
  while (sessionOrder.length > MAX_SESSIONS) {
    const oldest = sessionOrder.shift()!
    disposeSession(oldest)
  }
}
```

---

## Testing Patterns

### Component Testing
```typescript
import { render } from "solid-testing-library"

describe("MyComponent", () => {
  it("renders correctly", () => {
    const { getByText } = render(() => (
      <MyComponent name="Test" />
    ))

    expect(getByText("Test")).toBeInTheDocument()
  })

  it("handles clicks", async () => {
    const handleClick = vi.fn()
    const { getByRole } = render(() => (
      <MyComponent onClick={handleClick} />
    ))

    await userEvent.click(getByRole("button"))
    expect(handleClick).toHaveBeenCalled()
  })
})
```

### Context Testing
```typescript
function renderWithContext(component: () => JSX.Element) {
  return render(() => (
    <TestProvider>
      {component()}
    </TestProvider>
  ))
}

it("uses context correctly", () => {
  const { getByText } = renderWithContext(() => <MyComponent />)
  expect(getByText("Context Value")).toBeInTheDocument()
})
```

---

## Anti-Patterns to Avoid

### Don't Destructure Props
```typescript
// ✗ Loses reactivity
function Bad({ name, value }: Props) {
  return <div>{name}</div>
}

// ✓ Keep props object
function Good(props: Props) {
  return <div>{props.name}</div>
}
```

### Don't Call Signals in Event Handlers Without Need
```typescript
// ✗ Unnecessary signal call
onClick={() => {
  const x = someSignal()  // Only call if needed
  doSomething()
}}

// ✓ Only call when needed
onClick={() => {
  doSomething()
}}
```

### Don't Create Signals in Render
```typescript
// ✗ Creates new signal on every render
function Bad(props: Props) {
  const [count, setCount] = createSignal(0)  // Inside render!
  return <div>{count()}</div>
}

// ✓ Create at component level
function Good(props: Props) {
  const [count, setCount] = createSignal(0)

  return <div>{count()}</div>
}
```
