# TUI Window System Integration Plan

**Goal:** Integrate the existing layout system into the OpenCode TUI so windows can be split, navigated, and each window can display a view.

**Architecture:** The App component will render through a LayoutProvider and LayoutRenderer instead of directly rendering routes. The routing system will be adapted to work with windows - navigating to a session will update the focused window's view. Window commands (split, navigate, close) will be handled via keybinds.

**Design:** [thoughts/shared/designs/2025-12-29-tui-window-system-design.md](../designs/2025-12-29-tui-window-system-design.md)

---

## Phase 1: Layout Context and Operations

### Task 1.1: Create Layout Operations Module

**Files:**

- Create: `packages/opencode/src/cli/cmd/tui/layout/operations.ts`
- Test: `packages/opencode/test/tui/layout/operations.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/opencode/test/tui/layout/operations.test.ts
import { describe, expect, test } from "bun:test"
import { Layout } from "../../../src/cli/cmd/tui/layout/types"
import { LayoutOperations } from "../../../src/cli/cmd/tui/layout/operations"

describe("LayoutOperations.createInitial", () => {
  test("creates single window layout with home view", () => {
    const layout = LayoutOperations.createInitial("home")
    expect(layout.root.type).toBe("window")
    expect((layout.root as Layout.Window.Info).viewID).toBe("home")
    expect(layout.focusedID).toBe((layout.root as Layout.Window.Info).id)
    expect(layout.floats).toEqual([])
  })
})

describe("LayoutOperations.splitWindow", () => {
  test("splits focused window vertically", () => {
    const initial = LayoutOperations.createInitial("session")
    const windowID = (initial.root as Layout.Window.Info).id
    const result = LayoutOperations.splitWindow(initial, windowID, "vertical", "home")

    expect(result.root.type).toBe("split")
    const split = result.root as Layout.Split.SplitInfo
    expect(split.direction).toBe("vertical")
    expect(split.children).toHaveLength(2)
    expect(split.ratios).toEqual([0.5, 0.5])
  })

  test("splits focused window horizontally", () => {
    const initial = LayoutOperations.createInitial("session")
    const windowID = (initial.root as Layout.Window.Info).id
    const result = LayoutOperations.splitWindow(initial, windowID, "horizontal", "home")

    expect(result.root.type).toBe("split")
    const split = result.root as Layout.Split.SplitInfo
    expect(split.direction).toBe("horizontal")
  })

  test("focuses the new window after split", () => {
    const initial = LayoutOperations.createInitial("session")
    const windowID = (initial.root as Layout.Window.Info).id
    const result = LayoutOperations.splitWindow(initial, windowID, "vertical", "home")

    const split = result.root as Layout.Split.SplitInfo
    const newWindow = split.children[1] as Layout.Window.Info
    expect(result.focusedID).toBe(newWindow.id)
  })
})

describe("LayoutOperations.closeWindow", () => {
  test("returns undefined when closing last window", () => {
    const initial = LayoutOperations.createInitial("session")
    const windowID = (initial.root as Layout.Window.Info).id
    const result = LayoutOperations.closeWindow(initial, windowID)

    expect(result).toBeUndefined()
  })

  test("removes window from split and collapses if one child remains", () => {
    const initial = LayoutOperations.createInitial("session")
    const windowID = (initial.root as Layout.Window.Info).id
    const withSplit = LayoutOperations.splitWindow(initial, windowID, "vertical", "home")

    const split = withSplit.root as Layout.Split.SplitInfo
    const newWindowID = (split.children[1] as Layout.Window.Info).id
    const result = LayoutOperations.closeWindow(withSplit, newWindowID)

    expect(result).toBeDefined()
    expect(result!.root.type).toBe("window")
  })

  test("focuses sibling window after close", () => {
    const initial = LayoutOperations.createInitial("session")
    const windowID = (initial.root as Layout.Window.Info).id
    const withSplit = LayoutOperations.splitWindow(initial, windowID, "vertical", "home")

    const split = withSplit.root as Layout.Split.SplitInfo
    const originalWindow = split.children[0] as Layout.Window.Info
    const newWindowID = (split.children[1] as Layout.Window.Info).id
    const result = LayoutOperations.closeWindow(withSplit, newWindowID)

    expect(result!.focusedID).toBe(originalWindow.id)
  })
})

describe("LayoutOperations.focusDirection", () => {
  test("focuses window to the right in vertical split", () => {
    const initial = LayoutOperations.createInitial("session")
    const windowID = (initial.root as Layout.Window.Info).id
    const withSplit = LayoutOperations.splitWindow(initial, windowID, "vertical", "home")

    // Focus is on the new (right) window, navigate left
    const split = withSplit.root as Layout.Split.SplitInfo
    const leftWindow = split.children[0] as Layout.Window.Info
    const result = LayoutOperations.focusDirection(withSplit, "left")

    expect(result.focusedID).toBe(leftWindow.id)
  })

  test("returns same layout if no window in direction", () => {
    const initial = LayoutOperations.createInitial("session")
    const result = LayoutOperations.focusDirection(initial, "left")

    expect(result.focusedID).toBe(initial.focusedID)
  })
})

describe("LayoutOperations.updateWindowView", () => {
  test("updates view of specified window", () => {
    const initial = LayoutOperations.createInitial("home")
    const windowID = (initial.root as Layout.Window.Info).id
    const result = LayoutOperations.updateWindowView(initial, windowID, "session:abc123")

    expect((result.root as Layout.Window.Info).viewID).toBe("session:abc123")
  })
})

describe("LayoutOperations.findWindow", () => {
  test("finds window by id in single window layout", () => {
    const initial = LayoutOperations.createInitial("session")
    const windowID = (initial.root as Layout.Window.Info).id
    const found = LayoutOperations.findWindow(initial, windowID)

    expect(found).toBeDefined()
    expect(found!.id).toBe(windowID)
  })

  test("finds window by id in nested split", () => {
    const initial = LayoutOperations.createInitial("session")
    const windowID = (initial.root as Layout.Window.Info).id
    const withSplit = LayoutOperations.splitWindow(initial, windowID, "vertical", "home")

    const split = withSplit.root as Layout.Split.SplitInfo
    const newWindowID = (split.children[1] as Layout.Window.Info).id
    const found = LayoutOperations.findWindow(withSplit, newWindowID)

    expect(found).toBeDefined()
    expect(found!.id).toBe(newWindowID)
  })
})

describe("LayoutOperations.getAllWindows", () => {
  test("returns all windows in layout", () => {
    const initial = LayoutOperations.createInitial("session")
    const windowID = (initial.root as Layout.Window.Info).id
    const withSplit = LayoutOperations.splitWindow(initial, windowID, "vertical", "home")

    const windows = LayoutOperations.getAllWindows(withSplit)
    expect(windows).toHaveLength(2)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/opencode/test/tui/layout/operations.test.ts`
Expected: FAIL with "Cannot find module" or "LayoutOperations is not defined"

**Step 3: Write minimal implementation**

```typescript
// packages/opencode/src/cli/cmd/tui/layout/operations.ts
import { Layout } from "./types"

export namespace LayoutOperations {
  function generateID(): string {
    return Math.random().toString(36).substring(2, 10)
  }

  export function createInitial(viewID: string): Layout.Root.Info {
    const windowID = `win-${generateID()}`
    return Layout.Root.create({
      root: Layout.Window.create({
        id: windowID,
        viewID,
        focused: true,
      }),
      floats: [],
      focusedID: windowID,
    })
  }

  export function splitWindow(
    layout: Layout.Root.Info,
    windowID: string,
    direction: "horizontal" | "vertical",
    newViewID: string,
  ): Layout.Root.Info {
    const newWindowID = `win-${generateID()}`
    const newWindow = Layout.Window.create({
      id: newWindowID,
      viewID: newViewID,
      focused: true,
    })

    function splitNode(node: Layout.Node): Layout.Node {
      if (node.type === "window" && node.id === windowID) {
        return Layout.Split.create({
          id: `split-${generateID()}`,
          direction,
          children: [{ ...node, focused: false }, newWindow],
          ratios: [0.5, 0.5],
        })
      }
      if (node.type === "split") {
        return {
          ...node,
          children: node.children.map(splitNode),
        }
      }
      return node
    }

    return {
      ...layout,
      root: splitNode(layout.root),
      focusedID: newWindowID,
    }
  }

  export function closeWindow(layout: Layout.Root.Info, windowID: string): Layout.Root.Info | undefined {
    const windows = getAllWindows(layout)
    if (windows.length <= 1) return undefined

    function removeFromNode(node: Layout.Node): Layout.Node | undefined {
      if (node.type === "window") {
        return node.id === windowID ? undefined : node
      }
      if (node.type === "split") {
        const remaining = node.children.map(removeFromNode).filter((n): n is Layout.Node => n !== undefined)

        if (remaining.length === 0) return undefined
        if (remaining.length === 1) return remaining[0]
        return {
          ...node,
          children: remaining,
          ratios: remaining.map(() => 1 / remaining.length),
        }
      }
      return node
    }

    const newRoot = removeFromNode(layout.root)
    if (!newRoot) return undefined

    const remainingWindows = getAllWindowsFromNode(newRoot)
    const newFocusedID =
      layout.focusedID === windowID ? (remainingWindows[0]?.id ?? layout.focusedID) : layout.focusedID

    return {
      ...layout,
      root: newRoot,
      focusedID: newFocusedID,
    }
  }

  export function focusDirection(
    layout: Layout.Root.Info,
    direction: "left" | "right" | "up" | "down",
  ): Layout.Root.Info {
    const windows = getAllWindows(layout)
    const currentIndex = windows.findIndex((w) => w.id === layout.focusedID)
    if (currentIndex === -1) return layout

    const splitDirection = direction === "left" || direction === "right" ? "vertical" : "horizontal"
    const delta = direction === "left" || direction === "up" ? -1 : 1

    const targetWindow = findAdjacentWindow(layout.root, layout.focusedID, splitDirection, delta)
    if (!targetWindow) return layout

    return {
      ...layout,
      focusedID: targetWindow.id,
    }
  }

  function findAdjacentWindow(
    node: Layout.Node,
    currentID: string,
    splitDirection: "horizontal" | "vertical",
    delta: number,
  ): Layout.Window.Info | undefined {
    if (node.type === "window") return undefined

    const childIndex = node.children.findIndex((child) => {
      if (child.type === "window") return child.id === currentID
      return containsWindow(child, currentID)
    })

    if (childIndex === -1) return undefined

    if (node.direction === splitDirection) {
      const targetIndex = childIndex + delta
      if (targetIndex >= 0 && targetIndex < node.children.length) {
        const target = node.children[targetIndex]
        if (target.type === "window") return target
        return getFirstWindow(target)
      }
    }

    for (const child of node.children) {
      if (child.type === "split") {
        const found = findAdjacentWindow(child, currentID, splitDirection, delta)
        if (found) return found
      }
    }

    return undefined
  }

  function containsWindow(node: Layout.Node, windowID: string): boolean {
    if (node.type === "window") return node.id === windowID
    return node.children.some((child) => containsWindow(child, windowID))
  }

  function getFirstWindow(node: Layout.Node): Layout.Window.Info | undefined {
    if (node.type === "window") return node
    for (const child of node.children) {
      const found = getFirstWindow(child)
      if (found) return found
    }
    return undefined
  }

  export function updateWindowView(layout: Layout.Root.Info, windowID: string, viewID: string): Layout.Root.Info {
    function updateNode(node: Layout.Node): Layout.Node {
      if (node.type === "window" && node.id === windowID) {
        return { ...node, viewID }
      }
      if (node.type === "split") {
        return {
          ...node,
          children: node.children.map(updateNode),
        }
      }
      return node
    }

    return {
      ...layout,
      root: updateNode(layout.root),
    }
  }

  export function findWindow(layout: Layout.Root.Info, windowID: string): Layout.Window.Info | undefined {
    return findWindowInNode(layout.root, windowID)
  }

  function findWindowInNode(node: Layout.Node, windowID: string): Layout.Window.Info | undefined {
    if (node.type === "window") {
      return node.id === windowID ? node : undefined
    }
    for (const child of node.children) {
      const found = findWindowInNode(child, windowID)
      if (found) return found
    }
    return undefined
  }

  export function getAllWindows(layout: Layout.Root.Info): Layout.Window.Info[] {
    return getAllWindowsFromNode(layout.root)
  }

  function getAllWindowsFromNode(node: Layout.Node): Layout.Window.Info[] {
    if (node.type === "window") return [node]
    return node.children.flatMap(getAllWindowsFromNode)
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/opencode/test/tui/layout/operations.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/layout/operations.ts packages/opencode/test/tui/layout/operations.test.ts
git commit -m "feat(tui): add layout operations for window management"
```

---

### Task 1.2: Create Layout Context Provider

**Files:**

- Create: `packages/opencode/src/cli/cmd/tui/context/layout.tsx`
- Test: `packages/opencode/test/tui/layout/context.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/opencode/test/tui/layout/context.test.ts
import { describe, expect, test } from "bun:test"
import { Layout } from "../../../src/cli/cmd/tui/layout/types"

describe("Layout Context", () => {
  test("layout types are correctly defined", () => {
    const window = Layout.Window.create({
      id: "win-1",
      viewID: "home",
      focused: true,
    })
    expect(window.type).toBe("window")
    expect(window.viewID).toBe("home")
  })
})
```

**Step 2: Run test to verify it passes (types already exist)**

Run: `bun test packages/opencode/test/tui/layout/context.test.ts`
Expected: PASS (this is a sanity check)

**Step 3: Write the context implementation**

```typescript
// packages/opencode/src/cli/cmd/tui/context/layout.tsx
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { Layout } from "../layout/types"
import { LayoutOperations } from "../layout/operations"

export type ViewID = "home" | `session:${string}`

export function parseViewID(viewID: string): { type: "home" } | { type: "session"; sessionID: string } {
  if (viewID === "home") return { type: "home" }
  if (viewID.startsWith("session:")) {
    return { type: "session", sessionID: viewID.slice(8) }
  }
  return { type: "home" }
}

export function createViewID(route: { type: "home" } | { type: "session"; sessionID: string }): ViewID {
  if (route.type === "home") return "home"
  return `session:${route.sessionID}`
}

export const { use: useLayout, provider: LayoutProvider } = createSimpleContext({
  name: "Layout",
  init: () => {
    const [store, setStore] = createStore<Layout.Root.Info>(LayoutOperations.createInitial("home"))

    return {
      get layout() {
        return store
      },
      get focusedWindowID() {
        return store.focusedID
      },
      get focusedViewID() {
        const window = LayoutOperations.findWindow(store, store.focusedID)
        return window?.viewID ?? "home"
      },
      splitVertical(viewID: ViewID = "home") {
        setStore(LayoutOperations.splitWindow(store, store.focusedID, "vertical", viewID))
      },
      splitHorizontal(viewID: ViewID = "home") {
        setStore(LayoutOperations.splitWindow(store, store.focusedID, "horizontal", viewID))
      },
      closeWindow(windowID?: string) {
        const id = windowID ?? store.focusedID
        const result = LayoutOperations.closeWindow(store, id)
        if (result) {
          setStore(result)
          return true
        }
        return false
      },
      focusLeft() {
        setStore(LayoutOperations.focusDirection(store, "left"))
      },
      focusRight() {
        setStore(LayoutOperations.focusDirection(store, "right"))
      },
      focusUp() {
        setStore(LayoutOperations.focusDirection(store, "up"))
      },
      focusDown() {
        setStore(LayoutOperations.focusDirection(store, "down"))
      },
      setView(viewID: ViewID, windowID?: string) {
        const id = windowID ?? store.focusedID
        setStore(LayoutOperations.updateWindowView(store, id, viewID))
      },
      getWindows() {
        return LayoutOperations.getAllWindows(store)
      },
    }
  },
})

export type LayoutContext = ReturnType<typeof useLayout>
```

**Step 4: Run typecheck to verify**

Run: `bun run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/context/layout.tsx packages/opencode/test/tui/layout/context.test.ts
git commit -m "feat(tui): add layout context provider"
```

---

## Phase 2: Layout Renderer Component

### Task 2.1: Create Layout Renderer

**Files:**

- Create: `packages/opencode/src/cli/cmd/tui/layout/renderer.tsx`
- Modify: `packages/opencode/src/cli/cmd/tui/layout/index.ts` (create barrel export)

**Step 1: Write the renderer component**

```typescript
// packages/opencode/src/cli/cmd/tui/layout/renderer.tsx
import { Match, Switch, For, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { Layout } from "./types"
import { useLayout } from "../context/layout"
import { useTheme } from "../context/theme"

interface WindowRendererProps {
  window: Layout.Window.Info
  width: number
  height: number
}

interface SplitRendererProps {
  split: Layout.Split.SplitInfo
  width: number
  height: number
}

interface NodeRendererProps {
  node: Layout.Node
  width: number
  height: number
}

function WindowRenderer(props: WindowRendererProps) {
  const layout = useLayout()
  const { theme } = useTheme()
  const focused = createMemo(() => props.window.id === layout.focusedWindowID)

  return (
    <box
      width={props.width}
      height={props.height}
      border={focused() ? ["all"] : undefined}
      borderColor={focused() ? theme.borderActive : theme.border}
    >
      <LayoutViewRenderer viewID={props.window.viewID} />
    </box>
  )
}

function SplitRenderer(props: SplitRendererProps) {
  const sizes = createMemo(() => {
    const total = props.split.direction === "horizontal" ? props.height : props.width
    return props.split.ratios.map((ratio) => Math.floor(total * ratio))
  })

  return (
    <box
      width={props.width}
      height={props.height}
      flexDirection={props.split.direction === "horizontal" ? "column" : "row"}
    >
      <For each={props.split.children}>
        {(child, index) => (
          <NodeRenderer
            node={child}
            width={props.split.direction === "horizontal" ? props.width : sizes()[index()]}
            height={props.split.direction === "horizontal" ? sizes()[index()] : props.height}
          />
        )}
      </For>
    </box>
  )
}

function NodeRenderer(props: NodeRendererProps) {
  return (
    <Switch>
      <Match when={props.node.type === "window"}>
        <WindowRenderer
          window={props.node as Layout.Window.Info}
          width={props.width}
          height={props.height}
        />
      </Match>
      <Match when={props.node.type === "split"}>
        <SplitRenderer
          split={props.node as Layout.Split.SplitInfo}
          width={props.width}
          height={props.height}
        />
      </Match>
    </Switch>
  )
}

// This will be replaced with actual view rendering in Task 3
function LayoutViewRenderer(props: { viewID: string }) {
  const { theme } = useTheme()
  return (
    <box flexGrow={1} justifyContent="center" alignItems="center">
      <text fg={theme.textMuted}>View: {props.viewID}</text>
    </box>
  )
}

export function LayoutRenderer() {
  const layout = useLayout()
  const dimensions = useTerminalDimensions()

  return (
    <NodeRenderer
      node={layout.layout.root}
      width={dimensions().width}
      height={dimensions().height}
    />
  )
}
```

**Step 2: Create barrel export**

```typescript
// packages/opencode/src/cli/cmd/tui/layout/index.ts
export { Layout } from "./types"
export { LayoutOperations } from "./operations"
export { LayoutRenderer } from "./renderer"
```

**Step 3: Run typecheck to verify**

Run: `bun run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/layout/renderer.tsx packages/opencode/src/cli/cmd/tui/layout/index.ts
git commit -m "feat(tui): add layout renderer component"
```

---

## Phase 3: View Registry and Rendering

### Task 3.1: Create View Registry

**Files:**

- Create: `packages/opencode/src/cli/cmd/tui/view/registry.tsx`
- Create: `packages/opencode/src/cli/cmd/tui/view/index.ts`

**Step 1: Write the view registry**

```typescript
// packages/opencode/src/cli/cmd/tui/view/registry.tsx
import type { Component } from "solid-js"

export interface ViewDefinition {
  id: string
  component: Component<{ width: number; height: number }>
}

const views = new Map<string, ViewDefinition>()

export namespace ViewRegistry {
  export function register(definition: ViewDefinition) {
    views.set(definition.id, definition)
  }

  export function get(id: string): ViewDefinition | undefined {
    // Handle parameterized view IDs like "session:abc123"
    const baseID = id.split(":")[0]
    return views.get(baseID)
  }

  export function getAll(): ViewDefinition[] {
    return Array.from(views.values())
  }
}
```

**Step 2: Create barrel export**

```typescript
// packages/opencode/src/cli/cmd/tui/view/index.ts
export { ViewRegistry, type ViewDefinition } from "./registry"
```

**Step 3: Run typecheck to verify**

Run: `bun run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/view/registry.tsx packages/opencode/src/cli/cmd/tui/view/index.ts
git commit -m "feat(tui): add view registry for window content"
```

---

### Task 3.2: Register Built-in Views

**Files:**

- Create: `packages/opencode/src/cli/cmd/tui/view/builtin.tsx`
- Modify: `packages/opencode/src/cli/cmd/tui/layout/renderer.tsx`

**Step 1: Create built-in view wrappers**

```typescript
// packages/opencode/src/cli/cmd/tui/view/builtin.tsx
import { ViewRegistry } from "./registry"
import { Home } from "../routes/home"
import { Session } from "../routes/session"
import { parseViewID } from "../context/layout"
import { createMemo, Show } from "solid-js"
import { useSync } from "../context/sync"

// Home view wrapper
function HomeView(props: { width: number; height: number }) {
  return <Home />
}

// Session view wrapper - extracts sessionID from viewID
function SessionView(props: { width: number; height: number; viewID: string }) {
  const parsed = createMemo(() => parseViewID(props.viewID))
  const sync = useSync()

  return (
    <Show
      when={parsed().type === "session"}
      fallback={<Home />}
    >
      <Session />
    </Show>
  )
}

export function registerBuiltinViews() {
  ViewRegistry.register({
    id: "home",
    component: HomeView,
  })

  ViewRegistry.register({
    id: "session",
    component: SessionView,
  })
}
```

**Step 2: Update renderer to use view registry**

```typescript
// packages/opencode/src/cli/cmd/tui/layout/renderer.tsx
import { Match, Switch, For, createMemo, Show } from "solid-js"
import { Dynamic } from "solid-js/web"
import { useTerminalDimensions } from "@opentui/solid"
import { Layout } from "./types"
import { useLayout, parseViewID } from "../context/layout"
import { useTheme } from "../context/theme"
import { ViewRegistry } from "../view"
import { Home } from "../routes/home"
import { Session } from "../routes/session"

interface WindowRendererProps {
  window: Layout.Window.Info
  width: number
  height: number
}

interface SplitRendererProps {
  split: Layout.Split.SplitInfo
  width: number
  height: number
}

interface NodeRendererProps {
  node: Layout.Node
  width: number
  height: number
}

function WindowRenderer(props: WindowRendererProps) {
  const layout = useLayout()
  const { theme } = useTheme()
  const focused = createMemo(() => props.window.id === layout.focusedWindowID)
  const windows = createMemo(() => layout.getWindows())
  const showBorder = createMemo(() => windows().length > 1)

  return (
    <box
      width={props.width}
      height={props.height}
      border={showBorder() ? ["all"] : undefined}
      borderColor={focused() ? theme.borderActive : theme.border}
    >
      <LayoutViewRenderer
        viewID={props.window.viewID}
        width={showBorder() ? props.width - 2 : props.width}
        height={showBorder() ? props.height - 2 : props.height}
      />
    </box>
  )
}

function SplitRenderer(props: SplitRendererProps) {
  const sizes = createMemo(() => {
    const total = props.split.direction === "horizontal" ? props.height : props.width
    return props.split.ratios.map((ratio) => Math.floor(total * ratio))
  })

  return (
    <box
      width={props.width}
      height={props.height}
      flexDirection={props.split.direction === "horizontal" ? "column" : "row"}
    >
      <For each={props.split.children}>
        {(child, index) => (
          <NodeRenderer
            node={child}
            width={props.split.direction === "horizontal" ? props.width : sizes()[index()]}
            height={props.split.direction === "horizontal" ? sizes()[index()] : props.height}
          />
        )}
      </For>
    </box>
  )
}

function NodeRenderer(props: NodeRendererProps) {
  return (
    <Switch>
      <Match when={props.node.type === "window"}>
        <WindowRenderer
          window={props.node as Layout.Window.Info}
          width={props.width}
          height={props.height}
        />
      </Match>
      <Match when={props.node.type === "split"}>
        <SplitRenderer
          split={props.node as Layout.Split.SplitInfo}
          width={props.width}
          height={props.height}
        />
      </Match>
    </Switch>
  )
}

function LayoutViewRenderer(props: { viewID: string; width: number; height: number }) {
  const parsed = createMemo(() => parseViewID(props.viewID))

  return (
    <box width={props.width} height={props.height}>
      <Switch>
        <Match when={parsed().type === "home"}>
          <Home />
        </Match>
        <Match when={parsed().type === "session"}>
          <Session />
        </Match>
      </Switch>
    </box>
  )
}

export function LayoutRenderer() {
  const layout = useLayout()
  const dimensions = useTerminalDimensions()

  return (
    <NodeRenderer
      node={layout.layout.root}
      width={dimensions().width}
      height={dimensions().height}
    />
  )
}
```

**Step 3: Run typecheck to verify**

Run: `bun run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/view/builtin.tsx packages/opencode/src/cli/cmd/tui/layout/renderer.tsx
git commit -m "feat(tui): register built-in views and update renderer"
```

---

## Phase 4: Route-Layout Integration

### Task 4.1: Bridge Route Context to Layout Context

**Files:**

- Modify: `packages/opencode/src/cli/cmd/tui/context/route.tsx`

**Step 1: Read current route.tsx**

Already read above - it's a simple store with navigate function.

**Step 2: Update route context to work with layout**

The route context will remain as-is for now. The integration happens in the App component where we sync route changes to the layout's focused window.

**Step 3: Create route-layout bridge hook**

```typescript
// packages/opencode/src/cli/cmd/tui/context/route-layout-bridge.tsx
import { createEffect, on } from "solid-js"
import { useRoute } from "./route"
import { useLayout, createViewID, parseViewID } from "./layout"

export function useRouteLayoutBridge() {
  const route = useRoute()
  const layout = useLayout()

  // Sync route changes to focused window's view
  createEffect(
    on(
      () => route.data,
      (routeData) => {
        const viewID = createViewID(routeData)
        layout.setView(viewID)
      },
    ),
  )

  // Sync focused window view changes to route
  createEffect(
    on(
      () => layout.focusedViewID,
      (viewID) => {
        const parsed = parseViewID(viewID)
        if (parsed.type !== route.data.type) {
          route.navigate(parsed)
        }
        if (parsed.type === "session" && route.data.type === "session") {
          if (parsed.sessionID !== route.data.sessionID) {
            route.navigate(parsed)
          }
        }
      },
    ),
  )
}
```

**Step 4: Run typecheck to verify**

Run: `bun run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/context/route-layout-bridge.tsx
git commit -m "feat(tui): add route-layout bridge for syncing navigation"
```

---

## Phase 5: Window Commands

### Task 5.1: Add Window Command Keybinds

**Files:**

- Create: `packages/opencode/src/cli/cmd/tui/context/window-commands.tsx`

**Step 1: Write the window commands handler**

```typescript
// packages/opencode/src/cli/cmd/tui/context/window-commands.tsx
import { useKeyboard } from "@opentui/solid"
import { useLayout } from "./layout"
import { useExit } from "./exit"
import { useDialog } from "../ui/dialog"

export function useWindowCommands() {
  const layout = useLayout()
  const exit = useExit()
  const dialog = useDialog()

  useKeyboard((evt) => {
    // Skip if dialog is open
    if (dialog.stack.length > 0) return

    // Window commands use Alt+Shift prefix
    if (!evt.alt || !evt.shift) return

    switch (evt.name) {
      case "v":
      case "V":
        // Alt+Shift+V: Split vertical
        layout.splitVertical()
        break
      case "s":
      case "S":
        // Alt+Shift+S: Split horizontal
        layout.splitHorizontal()
        break
      case "h":
      case "H":
        // Alt+Shift+H: Focus left
        layout.focusLeft()
        break
      case "j":
      case "J":
        // Alt+Shift+J: Focus down
        layout.focusDown()
        break
      case "k":
      case "K":
        // Alt+Shift+K: Focus up
        layout.focusUp()
        break
      case "l":
      case "L":
        // Alt+Shift+L: Focus right
        layout.focusRight()
        break
      case "c":
      case "C":
        // Alt+Shift+C: Close window
        const closed = layout.closeWindow()
        if (!closed) {
          // Last window - exit app
          exit()
        }
        break
    }
  })
}
```

**Step 2: Run typecheck to verify**

Run: `bun run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/context/window-commands.tsx
git commit -m "feat(tui): add window command keybinds"
```

---

## Phase 6: App Integration

### Task 6.1: Integrate Layout System into App

**Files:**

- Modify: `packages/opencode/src/cli/cmd/tui/app.tsx`

**Step 1: Update App component to use layout system**

The key changes to `app.tsx`:

1. Add `LayoutProvider` to the provider tree
2. Replace the `Switch/Match` for routes with `LayoutRenderer`
3. Add `useWindowCommands()` hook
4. Add `useRouteLayoutBridge()` hook

```typescript
// In the provider tree (around line 118-144), add LayoutProvider:
// Before RouteProvider, add:
import { LayoutProvider } from "@tui/context/layout"

// Update the provider nesting:
<RouteProvider>
  <LayoutProvider>
    <SDKProvider url={input.url}>
      {/* ... rest of providers ... */}
    </SDKProvider>
  </LayoutProvider>
</RouteProvider>

// In the App component, replace the Switch/Match (lines 602-609):
// Before:
<Switch>
  <Match when={route.data.type === "home"}>
    <Home />
  </Match>
  <Match when={route.data.type === "session"}>
    <Session />
  </Match>
</Switch>

// After:
import { LayoutRenderer } from "@tui/layout"
import { useWindowCommands } from "@tui/context/window-commands"
import { useRouteLayoutBridge } from "@tui/context/route-layout-bridge"

// Inside App function, add:
useWindowCommands()
useRouteLayoutBridge()

// Replace the Switch with:
<LayoutRenderer />
```

**Step 2: Full modified App component render section**

The return statement in App (around line 578-611) should become:

```tsx
return (
  <box
    width={dimensions().width}
    height={dimensions().height}
    backgroundColor={theme.background}
    onMouseUp={async () => {
      if (Flag.OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) {
        renderer.clearSelection()
        return
      }
      const text = renderer.getSelection()?.getSelectedText()
      if (text && text.length > 0) {
        const base64 = Buffer.from(text).toString("base64")
        const osc52 = `\x1b]52;c;${base64}\x07`
        const finalOsc52 = process.env["TMUX"] ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
        /* @ts-expect-error */
        renderer.writeOut(finalOsc52)
        await Clipboard.copy(text)
          .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
          .catch(toast.error)
        renderer.clearSelection()
      }
    }}
  >
    <LayoutRenderer />
  </box>
)
```

**Step 3: Run typecheck to verify**

Run: `bun run typecheck`
Expected: PASS

**Step 4: Manual test**

Run: `bun dev`
Expected: App renders with single window showing home view

**Step 5: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/app.tsx
git commit -m "feat(tui): integrate layout system into app"
```

---

## Phase 7: Session View Adaptation

### Task 7.1: Update Session Component for Window Context

**Files:**

- Modify: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

**Step 1: Update Session to get sessionID from layout context**

The Session component currently uses `useRouteData("session")` to get the sessionID. We need to update it to work with the layout system while maintaining backward compatibility.

Add at the top of the Session function:

```typescript
import { useLayout, parseViewID } from "@tui/context/layout"

export function Session() {
  const layout = useLayout()
  const viewID = layout.focusedViewID
  const parsed = parseViewID(viewID)

  // Get sessionID from layout context
  const sessionID = parsed.type === "session" ? parsed.sessionID : undefined

  // If no sessionID, this shouldn't render (handled by LayoutViewRenderer)
  if (!sessionID) return null

  // ... rest of component uses sessionID instead of route.sessionID
}
```

However, this is a significant refactor. A simpler approach is to keep the route context as the source of truth and have the layout system sync with it.

**Alternative approach - minimal changes:**

Keep Session using `useRouteData("session")` as-is. The route-layout bridge ensures the route is always in sync with the focused window's view.

**Step 2: Verify existing behavior works**

Run: `bun dev`
Expected: Session view renders correctly when navigating to a session

**Step 3: Commit (if changes made)**

```bash
git add packages/opencode/src/cli/cmd/tui/routes/session/index.tsx
git commit -m "feat(tui): adapt session component for window context"
```

---

## Phase 8: Testing and Polish

### Task 8.1: Add Integration Tests

**Files:**

- Create: `packages/opencode/test/tui/layout/integration.test.ts`

**Step 1: Write integration tests**

```typescript
// packages/opencode/test/tui/layout/integration.test.ts
import { describe, expect, test } from "bun:test"
import { Layout } from "../../../src/cli/cmd/tui/layout/types"
import { LayoutOperations } from "../../../src/cli/cmd/tui/layout/operations"

describe("Layout Integration", () => {
  test("full workflow: create, split, navigate, close", () => {
    // Create initial layout
    const initial = LayoutOperations.createInitial("home")
    expect(LayoutOperations.getAllWindows(initial)).toHaveLength(1)

    // Split vertically
    const windowID = (initial.root as Layout.Window.Info).id
    const afterSplit = LayoutOperations.splitWindow(initial, windowID, "vertical", "session:abc")
    expect(LayoutOperations.getAllWindows(afterSplit)).toHaveLength(2)

    // Navigate left
    const afterNav = LayoutOperations.focusDirection(afterSplit, "left")
    const split = afterSplit.root as Layout.Split.SplitInfo
    const leftWindow = split.children[0] as Layout.Window.Info
    expect(afterNav.focusedID).toBe(leftWindow.id)

    // Close focused window
    const afterClose = LayoutOperations.closeWindow(afterNav, afterNav.focusedID)
    expect(afterClose).toBeDefined()
    expect(LayoutOperations.getAllWindows(afterClose!)).toHaveLength(1)
  })

  test("nested splits work correctly", () => {
    const initial = LayoutOperations.createInitial("home")
    const windowID = (initial.root as Layout.Window.Info).id

    // First split
    const split1 = LayoutOperations.splitWindow(initial, windowID, "vertical", "session:1")

    // Second split on new window
    const newWindowID = ((split1.root as Layout.Split.SplitInfo).children[1] as Layout.Window.Info).id
    const split2 = LayoutOperations.splitWindow(split1, newWindowID, "horizontal", "session:2")

    expect(LayoutOperations.getAllWindows(split2)).toHaveLength(3)
  })
})
```

**Step 2: Run tests**

Run: `bun test packages/opencode/test/tui/layout/integration.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/opencode/test/tui/layout/integration.test.ts
git commit -m "test(tui): add layout integration tests"
```

---

### Task 8.2: Add Window Resize Operations

**Files:**

- Modify: `packages/opencode/src/cli/cmd/tui/layout/operations.ts`
- Modify: `packages/opencode/test/tui/layout/operations.test.ts`

**Step 1: Add resize tests**

```typescript
// Add to packages/opencode/test/tui/layout/operations.test.ts

describe("LayoutOperations.resizeWindow", () => {
  test("increases window size in split", () => {
    const initial = LayoutOperations.createInitial("session")
    const windowID = (initial.root as Layout.Window.Info).id
    const withSplit = LayoutOperations.splitWindow(initial, windowID, "vertical", "home")

    const result = LayoutOperations.resizeWindow(withSplit, withSplit.focusedID, 0.1)
    const split = result.root as Layout.Split.SplitInfo
    expect(split.ratios[1]).toBeCloseTo(0.6, 1)
    expect(split.ratios[0]).toBeCloseTo(0.4, 1)
  })

  test("decreases window size in split", () => {
    const initial = LayoutOperations.createInitial("session")
    const windowID = (initial.root as Layout.Window.Info).id
    const withSplit = LayoutOperations.splitWindow(initial, windowID, "vertical", "home")

    const result = LayoutOperations.resizeWindow(withSplit, withSplit.focusedID, -0.1)
    const split = result.root as Layout.Split.SplitInfo
    expect(split.ratios[1]).toBeCloseTo(0.4, 1)
    expect(split.ratios[0]).toBeCloseTo(0.6, 1)
  })

  test("clamps resize to valid range", () => {
    const initial = LayoutOperations.createInitial("session")
    const windowID = (initial.root as Layout.Window.Info).id
    const withSplit = LayoutOperations.splitWindow(initial, windowID, "vertical", "home")

    const result = LayoutOperations.resizeWindow(withSplit, withSplit.focusedID, 0.9)
    const split = result.root as Layout.Split.SplitInfo
    // Should clamp to max 0.9
    expect(split.ratios[1]).toBeLessThanOrEqual(0.9)
    expect(split.ratios[0]).toBeGreaterThanOrEqual(0.1)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/opencode/test/tui/layout/operations.test.ts`
Expected: FAIL with "resizeWindow is not a function"

**Step 3: Implement resize**

```typescript
// Add to packages/opencode/src/cli/cmd/tui/layout/operations.ts

export function resizeWindow(layout: Layout.Root.Info, windowID: string, delta: number): Layout.Root.Info {
  function resizeInNode(node: Layout.Node): Layout.Node {
    if (node.type !== "split") return node

    const childIndex = node.children.findIndex((child) => {
      if (child.type === "window") return child.id === windowID
      return containsWindow(child, windowID)
    })

    if (childIndex === -1) {
      return {
        ...node,
        children: node.children.map(resizeInNode),
      }
    }

    const newRatios = [...node.ratios]
    const currentRatio = newRatios[childIndex]
    const newRatio = Math.max(0.1, Math.min(0.9, currentRatio + delta))
    const ratioDiff = newRatio - currentRatio

    // Distribute the difference to other children
    const otherCount = newRatios.length - 1
    newRatios[childIndex] = newRatio
    for (let i = 0; i < newRatios.length; i++) {
      if (i !== childIndex) {
        newRatios[i] = Math.max(0.1, newRatios[i] - ratioDiff / otherCount)
      }
    }

    // Normalize ratios to sum to 1
    const sum = newRatios.reduce((a, b) => a + b, 0)
    const normalizedRatios = newRatios.map((r) => r / sum)

    return {
      ...node,
      ratios: normalizedRatios,
      children: node.children.map(resizeInNode),
    }
  }

  return {
    ...layout,
    root: resizeInNode(layout.root),
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/opencode/test/tui/layout/operations.test.ts`
Expected: PASS

**Step 5: Add resize to context and commands**

Update `packages/opencode/src/cli/cmd/tui/context/layout.tsx`:

```typescript
// Add to the context return object:
resizeWidth(delta: number) {
  setStore(LayoutOperations.resizeWindow(store, store.focusedID, delta))
},
resizeHeight(delta: number) {
  setStore(LayoutOperations.resizeWindow(store, store.focusedID, delta))
},
```

Update `packages/opencode/src/cli/cmd/tui/context/window-commands.tsx`:

```typescript
// Add cases for resize:
case "+":
case "=":
  // Alt+Shift++: Increase size
  layout.resizeWidth(0.05)
  break
case "-":
case "_":
  // Alt+Shift+-: Decrease size
  layout.resizeWidth(-0.05)
  break
```

**Step 6: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/layout/operations.ts packages/opencode/test/tui/layout/operations.test.ts packages/opencode/src/cli/cmd/tui/context/layout.tsx packages/opencode/src/cli/cmd/tui/context/window-commands.tsx
git commit -m "feat(tui): add window resize operations"
```

---

## Summary

This plan implements the TUI window system integration in 8 phases:

1. **Layout Operations** - Core tree manipulation functions
2. **Layout Renderer** - SolidJS component for rendering the layout tree
3. **View Registry** - System for registering and rendering views
4. **Route-Layout Bridge** - Syncing between route and layout contexts
5. **Window Commands** - Keybinds for split/navigate/close
6. **App Integration** - Wiring everything into the main App component
7. **Session Adaptation** - Ensuring Session works with window context
8. **Testing and Polish** - Integration tests and resize operations

Each task follows TDD with failing test first, minimal implementation, verification, and commit.

**Key keybinds:**

- `Alt+Shift+V` - Split vertical
- `Alt+Shift+S` - Split horizontal
- `Alt+Shift+H/J/K/L` - Navigate windows
- `Alt+Shift+C` - Close window
- `Alt+Shift++/-` - Resize window
