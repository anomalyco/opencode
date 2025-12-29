# TUI Window System Implementation Plan

**Goal:** Implement a Vim-style window system for the OpenCode TUI with splits, floats, and plugin-provided views.

**Architecture:** A tree-based layout manager with Window, Split, and Float primitives. Views are either built-in (session, home) or plugin-provided using typed primitives (tree, list, text, form). Window commands use `<C-w>` prefix with Vim-style navigation.

**Design:** [thoughts/shared/designs/2025-12-29-tui-window-system-design.md](./2025-12-29-tui-window-system-design.md)

---

## Phase 1: Core Layout Primitives

### Task 1.1: Layout Types and Schemas

**Files:**

- Create: `packages/opencode/src/cli/cmd/tui/layout/types.ts`
- Test: `packages/opencode/test/tui/layout/types.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/opencode/test/tui/layout/types.test.ts
import { describe, expect, test } from "bun:test"
import { Layout } from "../../../src/cli/cmd/tui/layout/types"

describe("Layout.Window", () => {
  test("creates a window with view reference", () => {
    const window = Layout.Window.create({
      id: "win-1",
      viewID: "session",
    })
    expect(window.id).toBe("win-1")
    expect(window.viewID).toBe("session")
    expect(window.focused).toBe(false)
  })

  test("validates window schema", () => {
    const result = Layout.Window.Info.safeParse({
      id: "win-1",
      viewID: "session",
      focused: true,
    })
    expect(result.success).toBe(true)
  })
})

describe("Layout.Split", () => {
  test("creates horizontal split with children", () => {
    const split = Layout.Split.create({
      id: "split-1",
      direction: "horizontal",
      children: [
        { type: "window", id: "win-1", viewID: "session" },
        { type: "window", id: "win-2", viewID: "home" },
      ],
      ratios: [0.5, 0.5],
    })
    expect(split.direction).toBe("horizontal")
    expect(split.children).toHaveLength(2)
  })

  test("creates vertical split", () => {
    const split = Layout.Split.create({
      id: "split-1",
      direction: "vertical",
      children: [],
      ratios: [],
    })
    expect(split.direction).toBe("vertical")
  })
})

describe("Layout.Float", () => {
  test("creates float with position", () => {
    const float = Layout.Float.create({
      id: "float-1",
      viewID: "command-palette",
      x: 10,
      y: 5,
      width: 60,
      height: 20,
    })
    expect(float.x).toBe(10)
    expect(float.y).toBe(5)
    expect(float.width).toBe(60)
    expect(float.height).toBe(20)
  })
})

describe("Layout.Root", () => {
  test("creates root layout with single window", () => {
    const root = Layout.Root.create({
      root: { type: "window", id: "win-1", viewID: "session" },
      floats: [],
      focusedID: "win-1",
    })
    expect(root.focusedID).toBe("win-1")
    expect(root.floats).toHaveLength(0)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/opencode/test/tui/layout/types.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// packages/opencode/src/cli/cmd/tui/layout/types.ts
import z from "zod"

export namespace Layout {
  // Window: A rectangular area displaying a single view
  export namespace Window {
    export const Info = z.object({
      type: z.literal("window").default("window"),
      id: z.string(),
      viewID: z.string(),
      focused: z.boolean().default(false),
    })
    export type Info = z.output<typeof Info>

    export function create(input: { id: string; viewID: string; focused?: boolean }): Info {
      return {
        type: "window",
        id: input.id,
        viewID: input.viewID,
        focused: input.focused ?? false,
      }
    }
  }

  // Split: A container dividing space between children
  export namespace Split {
    export const Info: z.ZodType<SplitInfo> = z.lazy(() =>
      z.object({
        type: z.literal("split").default("split"),
        id: z.string(),
        direction: z.enum(["horizontal", "vertical"]),
        children: z.array(z.union([Window.Info, Info])),
        ratios: z.array(z.number()),
      }),
    )

    export type SplitInfo = {
      type: "split"
      id: string
      direction: "horizontal" | "vertical"
      children: Array<Window.Info | SplitInfo>
      ratios: number[]
    }

    export function create(input: {
      id: string
      direction: "horizontal" | "vertical"
      children: Array<Window.Info | SplitInfo>
      ratios: number[]
    }): SplitInfo {
      return {
        type: "split",
        id: input.id,
        direction: input.direction,
        children: input.children,
        ratios: input.ratios,
      }
    }
  }

  // Float: A window with absolute positioning
  export namespace Float {
    export const Info = z.object({
      id: z.string(),
      viewID: z.string(),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      focused: z.boolean().default(false),
    })
    export type Info = z.output<typeof Info>

    export function create(input: {
      id: string
      viewID: string
      x: number
      y: number
      width: number
      height: number
      focused?: boolean
    }): Info {
      return {
        id: input.id,
        viewID: input.viewID,
        x: input.x,
        y: input.y,
        width: input.width,
        height: input.height,
        focused: input.focused ?? false,
      }
    }
  }

  // Root: The top-level layout container
  export namespace Root {
    export const Info = z.object({
      root: z.union([Window.Info, Split.Info]),
      floats: z.array(Float.Info),
      focusedID: z.string(),
    })
    export type Info = z.output<typeof Info>

    export function create(input: {
      root: Window.Info | Split.SplitInfo
      floats: Float.Info[]
      focusedID: string
    }): Info {
      return {
        root: input.root,
        floats: input.floats,
        focusedID: input.focusedID,
      }
    }
  }

  // Node type union for tree traversal
  export type Node = Window.Info | Split.SplitInfo
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/opencode/test/tui/layout/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/layout/types.ts packages/opencode/test/tui/layout/types.test.ts
git commit -m "feat(tui): add layout type definitions for window system"
```

---

### Task 1.2: Layout Tree Operations

**Files:**

- Create: `packages/opencode/src/cli/cmd/tui/layout/operations.ts`
- Test: `packages/opencode/test/tui/layout/operations.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/opencode/test/tui/layout/operations.test.ts
import { describe, expect, test } from "bun:test"
import { Layout } from "../../../src/cli/cmd/tui/layout/types"
import { LayoutOps } from "../../../src/cli/cmd/tui/layout/operations"

describe("LayoutOps.findWindow", () => {
  test("finds window in flat layout", () => {
    const root = Layout.Root.create({
      root: Layout.Window.create({ id: "win-1", viewID: "session" }),
      floats: [],
      focusedID: "win-1",
    })
    const window = LayoutOps.findWindow(root, "win-1")
    expect(window?.id).toBe("win-1")
  })

  test("finds window in nested split", () => {
    const root = Layout.Root.create({
      root: Layout.Split.create({
        id: "split-1",
        direction: "horizontal",
        children: [
          Layout.Window.create({ id: "win-1", viewID: "session" }),
          Layout.Split.create({
            id: "split-2",
            direction: "vertical",
            children: [
              Layout.Window.create({ id: "win-2", viewID: "home" }),
              Layout.Window.create({ id: "win-3", viewID: "explorer" }),
            ],
            ratios: [0.5, 0.5],
          }),
        ],
        ratios: [0.3, 0.7],
      }),
      floats: [],
      focusedID: "win-1",
    })
    const window = LayoutOps.findWindow(root, "win-3")
    expect(window?.id).toBe("win-3")
    expect(window?.viewID).toBe("explorer")
  })

  test("returns undefined for non-existent window", () => {
    const root = Layout.Root.create({
      root: Layout.Window.create({ id: "win-1", viewID: "session" }),
      floats: [],
      focusedID: "win-1",
    })
    const window = LayoutOps.findWindow(root, "win-999")
    expect(window).toBeUndefined()
  })
})

describe("LayoutOps.splitWindow", () => {
  test("splits single window horizontally", () => {
    const root = Layout.Root.create({
      root: Layout.Window.create({ id: "win-1", viewID: "session" }),
      floats: [],
      focusedID: "win-1",
    })
    const result = LayoutOps.splitWindow(root, "win-1", "horizontal", {
      id: "win-2",
      viewID: "home",
    })
    expect(result.root.type).toBe("split")
    if (result.root.type === "split") {
      expect(result.root.direction).toBe("horizontal")
      expect(result.root.children).toHaveLength(2)
    }
  })

  test("splits single window vertically", () => {
    const root = Layout.Root.create({
      root: Layout.Window.create({ id: "win-1", viewID: "session" }),
      floats: [],
      focusedID: "win-1",
    })
    const result = LayoutOps.splitWindow(root, "win-1", "vertical", {
      id: "win-2",
      viewID: "home",
    })
    expect(result.root.type).toBe("split")
    if (result.root.type === "split") {
      expect(result.root.direction).toBe("vertical")
    }
  })
})

describe("LayoutOps.closeWindow", () => {
  test("closing last window returns null", () => {
    const root = Layout.Root.create({
      root: Layout.Window.create({ id: "win-1", viewID: "session" }),
      floats: [],
      focusedID: "win-1",
    })
    const result = LayoutOps.closeWindow(root, "win-1")
    expect(result).toBeNull()
  })

  test("closing window in split removes it", () => {
    const root = Layout.Root.create({
      root: Layout.Split.create({
        id: "split-1",
        direction: "horizontal",
        children: [
          Layout.Window.create({ id: "win-1", viewID: "session" }),
          Layout.Window.create({ id: "win-2", viewID: "home" }),
        ],
        ratios: [0.5, 0.5],
      }),
      floats: [],
      focusedID: "win-1",
    })
    const result = LayoutOps.closeWindow(root, "win-2")
    expect(result).not.toBeNull()
    expect(result!.root.type).toBe("window")
    if (result!.root.type === "window") {
      expect(result!.root.id).toBe("win-1")
    }
  })
})

describe("LayoutOps.focusDirection", () => {
  test("focuses window to the right", () => {
    const root = Layout.Root.create({
      root: Layout.Split.create({
        id: "split-1",
        direction: "vertical",
        children: [
          Layout.Window.create({ id: "win-1", viewID: "session" }),
          Layout.Window.create({ id: "win-2", viewID: "home" }),
        ],
        ratios: [0.5, 0.5],
      }),
      floats: [],
      focusedID: "win-1",
    })
    const result = LayoutOps.focusDirection(root, "right")
    expect(result.focusedID).toBe("win-2")
  })

  test("focuses window below", () => {
    const root = Layout.Root.create({
      root: Layout.Split.create({
        id: "split-1",
        direction: "horizontal",
        children: [
          Layout.Window.create({ id: "win-1", viewID: "session" }),
          Layout.Window.create({ id: "win-2", viewID: "home" }),
        ],
        ratios: [0.5, 0.5],
      }),
      floats: [],
      focusedID: "win-1",
    })
    const result = LayoutOps.focusDirection(root, "down")
    expect(result.focusedID).toBe("win-2")
  })

  test("stays on same window when no neighbor", () => {
    const root = Layout.Root.create({
      root: Layout.Window.create({ id: "win-1", viewID: "session" }),
      floats: [],
      focusedID: "win-1",
    })
    const result = LayoutOps.focusDirection(root, "right")
    expect(result.focusedID).toBe("win-1")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/opencode/test/tui/layout/operations.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// packages/opencode/src/cli/cmd/tui/layout/operations.ts
import { Layout } from "./types"

export namespace LayoutOps {
  let idCounter = 0
  export function generateID(prefix: string): string {
    return `${prefix}-${++idCounter}`
  }

  export function findWindow(root: Layout.Root.Info, windowID: string): Layout.Window.Info | undefined {
    function search(node: Layout.Node): Layout.Window.Info | undefined {
      if (node.type === "window") {
        return node.id === windowID ? node : undefined
      }
      for (const child of node.children) {
        const found = search(child)
        if (found) return found
      }
      return undefined
    }
    return search(root.root)
  }

  export function getAllWindows(root: Layout.Root.Info): Layout.Window.Info[] {
    const windows: Layout.Window.Info[] = []
    function collect(node: Layout.Node): void {
      if (node.type === "window") {
        windows.push(node)
        return
      }
      for (const child of node.children) {
        collect(child)
      }
    }
    collect(root.root)
    return windows
  }

  export function splitWindow(
    root: Layout.Root.Info,
    targetID: string,
    direction: "horizontal" | "vertical",
    newWindow: { id: string; viewID: string },
  ): Layout.Root.Info {
    function splitNode(node: Layout.Node): Layout.Node {
      if (node.type === "window") {
        if (node.id === targetID) {
          return Layout.Split.create({
            id: generateID("split"),
            direction,
            children: [node, Layout.Window.create({ id: newWindow.id, viewID: newWindow.viewID })],
            ratios: [0.5, 0.5],
          })
        }
        return node
      }

      return Layout.Split.create({
        id: node.id,
        direction: node.direction,
        children: node.children.map(splitNode),
        ratios: node.ratios,
      })
    }

    return {
      ...root,
      root: splitNode(root.root),
      focusedID: newWindow.id,
    }
  }

  export function closeWindow(root: Layout.Root.Info, windowID: string): Layout.Root.Info | null {
    const windows = getAllWindows(root)
    if (windows.length === 1 && windows[0].id === windowID) {
      return null
    }

    function removeFromNode(node: Layout.Node): Layout.Node | null {
      if (node.type === "window") {
        return node.id === windowID ? null : node
      }

      const newChildren: Layout.Node[] = []
      const newRatios: number[] = []
      let removedRatio = 0

      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]
        const result = removeFromNode(child)
        if (result !== null) {
          newChildren.push(result)
          newRatios.push(node.ratios[i])
        } else {
          removedRatio = node.ratios[i]
        }
      }

      if (newChildren.length === 0) return null
      if (newChildren.length === 1) return newChildren[0]

      const totalRatio = newRatios.reduce((a, b) => a + b, 0)
      const normalizedRatios = newRatios.map((r) => r / totalRatio)

      return Layout.Split.create({
        id: node.id,
        direction: node.direction,
        children: newChildren,
        ratios: normalizedRatios,
      })
    }

    const newRoot = removeFromNode(root.root)
    if (!newRoot) return null

    const remainingWindows = getAllWindows({ ...root, root: newRoot })
    const newFocusedID = root.focusedID === windowID ? (remainingWindows[0]?.id ?? "") : root.focusedID

    return {
      ...root,
      root: newRoot,
      focusedID: newFocusedID,
    }
  }

  export function focusDirection(
    root: Layout.Root.Info,
    direction: "left" | "right" | "up" | "down",
  ): Layout.Root.Info {
    const windows = getAllWindows(root)
    const currentIndex = windows.findIndex((w) => w.id === root.focusedID)
    if (currentIndex === -1) return root

    function findParentSplit(node: Layout.Node, targetID: string): Layout.Split.SplitInfo | null {
      if (node.type === "window") return null
      for (const child of node.children) {
        if (child.type === "window" && child.id === targetID) return node
        const found = findParentSplit(child, targetID)
        if (found) return found
      }
      return null
    }

    function findSiblingInDirection(
      split: Layout.Split.SplitInfo,
      currentID: string,
      dir: "left" | "right" | "up" | "down",
    ): string | null {
      const isHorizontal = split.direction === "horizontal"
      const isVertical = split.direction === "vertical"

      const currentIdx = split.children.findIndex((c) => c.type === "window" && c.id === currentID)
      if (currentIdx === -1) return null

      if ((dir === "down" && isHorizontal) || (dir === "right" && isVertical)) {
        const next = split.children[currentIdx + 1]
        if (next?.type === "window") return next.id
        if (next?.type === "split") return getFirstWindow(next)
      }

      if ((dir === "up" && isHorizontal) || (dir === "left" && isVertical)) {
        const prev = split.children[currentIdx - 1]
        if (prev?.type === "window") return prev.id
        if (prev?.type === "split") return getLastWindow(prev)
      }

      return null
    }

    function getFirstWindow(node: Layout.Node): string | null {
      if (node.type === "window") return node.id
      if (node.children.length === 0) return null
      return getFirstWindow(node.children[0])
    }

    function getLastWindow(node: Layout.Node): string | null {
      if (node.type === "window") return node.id
      if (node.children.length === 0) return null
      return getLastWindow(node.children[node.children.length - 1])
    }

    const parent = findParentSplit(root.root, root.focusedID)
    if (!parent) return root

    const newFocusedID = findSiblingInDirection(parent, root.focusedID, direction)
    if (!newFocusedID) return root

    return {
      ...root,
      focusedID: newFocusedID,
    }
  }

  export function resizeWindow(
    root: Layout.Root.Info,
    windowID: string,
    delta: number,
    dimension: "width" | "height",
  ): Layout.Root.Info {
    function resizeInNode(node: Layout.Node): Layout.Node {
      if (node.type === "window") return node

      const idx = node.children.findIndex((c) => {
        if (c.type === "window") return c.id === windowID
        return getAllWindows({ root: c, floats: [], focusedID: "" }).some((w) => w.id === windowID)
      })

      if (idx === -1) {
        return Layout.Split.create({
          ...node,
          children: node.children.map(resizeInNode),
        })
      }

      const isRelevant =
        (dimension === "width" && node.direction === "vertical") ||
        (dimension === "height" && node.direction === "horizontal")

      if (!isRelevant || node.children.length < 2) {
        return Layout.Split.create({
          ...node,
          children: node.children.map(resizeInNode),
        })
      }

      const newRatios = [...node.ratios]
      const change = delta * 0.05
      newRatios[idx] = Math.max(0.1, Math.min(0.9, newRatios[idx] + change))

      const otherIdx = idx === 0 ? 1 : idx - 1
      newRatios[otherIdx] = Math.max(0.1, Math.min(0.9, newRatios[otherIdx] - change))

      const total = newRatios.reduce((a, b) => a + b, 0)
      const normalized = newRatios.map((r) => r / total)

      return Layout.Split.create({
        ...node,
        ratios: normalized,
        children: node.children.map(resizeInNode),
      })
    }

    return {
      ...root,
      root: resizeInNode(root.root),
    }
  }

  export function equalizeWindows(root: Layout.Root.Info): Layout.Root.Info {
    function equalize(node: Layout.Node): Layout.Node {
      if (node.type === "window") return node

      const equalRatio = 1 / node.children.length
      return Layout.Split.create({
        ...node,
        ratios: node.children.map(() => equalRatio),
        children: node.children.map(equalize),
      })
    }

    return {
      ...root,
      root: equalize(root.root),
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/opencode/test/tui/layout/operations.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/layout/operations.ts packages/opencode/test/tui/layout/operations.test.ts
git commit -m "feat(tui): add layout tree operations for window management"
```

---

### Task 1.3: Layout Context Provider

**Files:**

- Create: `packages/opencode/src/cli/cmd/tui/context/layout.tsx`
- Modify: `packages/opencode/src/cli/cmd/tui/app.tsx`

**Step 1: Write the layout context**

```typescript
// packages/opencode/src/cli/cmd/tui/context/layout.tsx
import { createSignal, createMemo } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { Layout } from "../layout/types"
import { LayoutOps } from "../layout/operations"

export const { use: useLayout, provider: LayoutProvider } = createSimpleContext({
  name: "Layout",
  init: () => {
    const [layout, setLayout] = createStore<Layout.Root.Info>({
      root: Layout.Window.create({ id: "win-main", viewID: "session" }),
      floats: [],
      focusedID: "win-main",
    })

    const focusedWindow = createMemo(() => LayoutOps.findWindow(layout, layout.focusedID))
    const allWindows = createMemo(() => LayoutOps.getAllWindows(layout))

    return {
      get layout() {
        return layout
      },
      get focusedWindow() {
        return focusedWindow()
      },
      get allWindows() {
        return allWindows()
      },

      splitHorizontal(viewID: string) {
        const newID = LayoutOps.generateID("win")
        setLayout(
          produce((draft) => {
            const result = LayoutOps.splitWindow(draft, draft.focusedID, "horizontal", {
              id: newID,
              viewID,
            })
            Object.assign(draft, result)
          }),
        )
        return newID
      },

      splitVertical(viewID: string) {
        const newID = LayoutOps.generateID("win")
        setLayout(
          produce((draft) => {
            const result = LayoutOps.splitWindow(draft, draft.focusedID, "vertical", {
              id: newID,
              viewID,
            })
            Object.assign(draft, result)
          }),
        )
        return newID
      },

      closeWindow(windowID?: string) {
        const targetID = windowID ?? layout.focusedID
        const result = LayoutOps.closeWindow(layout, targetID)
        if (result === null) {
          return false
        }
        setLayout(result)
        return true
      },

      closeOtherWindows() {
        const focused = focusedWindow()
        if (!focused) return
        setLayout({
          root: focused,
          floats: [],
          focusedID: focused.id,
        })
      },

      focusWindow(windowID: string) {
        setLayout("focusedID", windowID)
      },

      focusDirection(direction: "left" | "right" | "up" | "down") {
        setLayout(
          produce((draft) => {
            const result = LayoutOps.focusDirection(draft, direction)
            draft.focusedID = result.focusedID
          }),
        )
      },

      resizeWindow(delta: number, dimension: "width" | "height") {
        setLayout(
          produce((draft) => {
            const result = LayoutOps.resizeWindow(draft, draft.focusedID, delta, dimension)
            Object.assign(draft, result)
          }),
        )
      },

      equalizeWindows() {
        setLayout(
          produce((draft) => {
            const result = LayoutOps.equalizeWindows(draft)
            Object.assign(draft, result)
          }),
        )
      },

      openFloat(viewID: string, options: { x: number; y: number; width: number; height: number }) {
        const id = LayoutOps.generateID("float")
        setLayout(
          produce((draft) => {
            draft.floats.push(
              Layout.Float.create({
                id,
                viewID,
                ...options,
              }),
            )
            draft.focusedID = id
          }),
        )
        return id
      },

      closeFloat(floatID: string) {
        setLayout(
          produce((draft) => {
            const idx = draft.floats.findIndex((f) => f.id === floatID)
            if (idx !== -1) {
              draft.floats.splice(idx, 1)
              if (draft.focusedID === floatID) {
                const windows = LayoutOps.getAllWindows(draft)
                draft.focusedID = windows[0]?.id ?? ""
              }
            }
          }),
        )
      },

      setWindowView(windowID: string, viewID: string) {
        setLayout(
          produce((draft) => {
            function updateNode(node: Layout.Node): void {
              if (node.type === "window" && node.id === windowID) {
                node.viewID = viewID
                return
              }
              if (node.type === "split") {
                node.children.forEach(updateNode)
              }
            }
            updateNode(draft.root)
          }),
        )
      },
    }
  },
})
```

**Step 2: Verify file compiles**

Run: `bun typecheck`
Expected: No errors related to layout.tsx

**Step 3: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/context/layout.tsx
git commit -m "feat(tui): add layout context provider for window state management"
```

---

## Phase 2: View Primitives

### Task 2.1: View Type Definitions

**Files:**

- Create: `packages/opencode/src/cli/cmd/tui/view/types.ts`
- Test: `packages/opencode/test/tui/view/types.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/opencode/test/tui/view/types.test.ts
import { describe, expect, test } from "bun:test"
import { View } from "../../../src/cli/cmd/tui/view/types"

describe("View.Tree", () => {
  test("creates tree view data", () => {
    const tree = View.Tree.create({
      id: "session-tree",
      title: "Sessions",
      nodes: [
        {
          id: "session-1",
          label: "Chat about TypeScript",
          icon: "chat",
          children: [],
          expanded: false,
        },
      ],
    })
    expect(tree.type).toBe("tree")
    expect(tree.nodes).toHaveLength(1)
  })

  test("validates tree node schema", () => {
    const result = View.Tree.Node.safeParse({
      id: "node-1",
      label: "Test Node",
      children: [],
    })
    expect(result.success).toBe(true)
  })
})

describe("View.List", () => {
  test("creates list view data", () => {
    const list = View.List.create({
      id: "command-palette",
      title: "Commands",
      items: [
        { id: "cmd-1", label: "New Session", description: "Create a new chat session" },
        { id: "cmd-2", label: "Switch Model", description: "Change the AI model" },
      ],
      searchable: true,
    })
    expect(list.type).toBe("list")
    expect(list.items).toHaveLength(2)
    expect(list.searchable).toBe(true)
  })
})

describe("View.Text", () => {
  test("creates text view data", () => {
    const text = View.Text.create({
      id: "help-view",
      title: "Help",
      content: "# OpenCode Help\n\nWelcome to OpenCode!",
      filetype: "markdown",
    })
    expect(text.type).toBe("text")
    expect(text.filetype).toBe("markdown")
  })
})

describe("View.Form", () => {
  test("creates form view data", () => {
    const form = View.Form.create({
      id: "settings",
      title: "Settings",
      fields: [
        { id: "theme", type: "select", label: "Theme", options: ["dark", "light"] },
        { id: "autosave", type: "toggle", label: "Auto-save", value: true },
      ],
    })
    expect(form.type).toBe("form")
    expect(form.fields).toHaveLength(2)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/opencode/test/tui/view/types.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// packages/opencode/src/cli/cmd/tui/view/types.ts
import z from "zod"

export namespace View {
  // Base view info shared by all view types
  export const Base = z.object({
    id: z.string(),
    title: z.string(),
  })

  // Tree view for hierarchical data (session explorer, file browser)
  export namespace Tree {
    export const Node: z.ZodType<NodeInfo> = z.lazy(() =>
      z.object({
        id: z.string(),
        label: z.string(),
        icon: z.string().optional(),
        children: z.array(Node),
        expanded: z.boolean().optional().default(false),
        metadata: z.record(z.any()).optional(),
      }),
    )

    export type NodeInfo = {
      id: string
      label: string
      icon?: string
      children: NodeInfo[]
      expanded?: boolean
      metadata?: Record<string, any>
    }

    export const Info = Base.extend({
      type: z.literal("tree"),
      nodes: z.array(Node),
      selectedID: z.string().optional(),
    })
    export type Info = z.output<typeof Info>

    export function create(input: { id: string; title: string; nodes: NodeInfo[]; selectedID?: string }): Info {
      return {
        type: "tree",
        id: input.id,
        title: input.title,
        nodes: input.nodes,
        selectedID: input.selectedID,
      }
    }
  }

  // List view for flat searchable items (command palette, session list)
  export namespace List {
    export const Item = z.object({
      id: z.string(),
      label: z.string(),
      description: z.string().optional(),
      icon: z.string().optional(),
      metadata: z.record(z.any()).optional(),
    })
    export type Item = z.output<typeof Item>

    export const Info = Base.extend({
      type: z.literal("list"),
      items: z.array(Item),
      searchable: z.boolean().optional().default(true),
      selectedID: z.string().optional(),
      searchQuery: z.string().optional(),
    })
    export type Info = z.output<typeof Info>

    export function create(input: {
      id: string
      title: string
      items: Item[]
      searchable?: boolean
      selectedID?: string
    }): Info {
      return {
        type: "list",
        id: input.id,
        title: input.title,
        items: input.items,
        searchable: input.searchable ?? true,
        selectedID: input.selectedID,
      }
    }
  }

  // Text view for read-only styled content (logs, previews, help)
  export namespace Text {
    export const Info = Base.extend({
      type: z.literal("text"),
      content: z.string(),
      filetype: z.string().optional(),
      scrollOffset: z.number().optional().default(0),
    })
    export type Info = z.output<typeof Info>

    export function create(input: { id: string; title: string; content: string; filetype?: string }): Info {
      return {
        type: "text",
        id: input.id,
        title: input.title,
        content: input.content,
        filetype: input.filetype,
        scrollOffset: 0,
      }
    }
  }

  // Form view for settings and input
  export namespace Form {
    export const Field = z.discriminatedUnion("type", [
      z.object({
        id: z.string(),
        type: z.literal("text"),
        label: z.string(),
        value: z.string().optional(),
        placeholder: z.string().optional(),
      }),
      z.object({
        id: z.string(),
        type: z.literal("toggle"),
        label: z.string(),
        value: z.boolean().optional(),
      }),
      z.object({
        id: z.string(),
        type: z.literal("select"),
        label: z.string(),
        options: z.array(z.string()),
        value: z.string().optional(),
      }),
      z.object({
        id: z.string(),
        type: z.literal("number"),
        label: z.string(),
        value: z.number().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
      }),
    ])
    export type Field = z.output<typeof Field>

    export const Info = Base.extend({
      type: z.literal("form"),
      fields: z.array(Field),
      focusedFieldID: z.string().optional(),
    })
    export type Info = z.output<typeof Info>

    export function create(input: { id: string; title: string; fields: Field[] }): Info {
      return {
        type: "form",
        id: input.id,
        title: input.title,
        fields: input.fields,
      }
    }
  }

  // Union of all view types
  export type Info = Tree.Info | List.Info | Text.Info | Form.Info

  // Built-in view identifiers (not replaceable by plugins)
  export const BuiltIn = z.enum(["session", "home"])
  export type BuiltIn = z.infer<typeof BuiltIn>
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/opencode/test/tui/view/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/view/types.ts packages/opencode/test/tui/view/types.test.ts
git commit -m "feat(tui): add view type definitions for tree, list, text, and form primitives"
```

---

### Task 2.2: View Registry

**Files:**

- Create: `packages/opencode/src/cli/cmd/tui/view/registry.ts`
- Test: `packages/opencode/test/tui/view/registry.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/opencode/test/tui/view/registry.test.ts
import { describe, expect, test, beforeEach } from "bun:test"
import { ViewRegistry } from "../../../src/cli/cmd/tui/view/registry"
import { View } from "../../../src/cli/cmd/tui/view/types"

describe("ViewRegistry", () => {
  beforeEach(() => {
    ViewRegistry.clear()
  })

  test("registers and retrieves a view", () => {
    const treeView = View.Tree.create({
      id: "test-tree",
      title: "Test Tree",
      nodes: [],
    })

    ViewRegistry.register("test-tree", treeView)
    const retrieved = ViewRegistry.get("test-tree")

    expect(retrieved).toBeDefined()
    expect(retrieved?.id).toBe("test-tree")
    expect(retrieved?.type).toBe("tree")
  })

  test("updates an existing view", () => {
    const initial = View.List.create({
      id: "test-list",
      title: "Test List",
      items: [{ id: "item-1", label: "Item 1" }],
    })

    ViewRegistry.register("test-list", initial)

    const updated = View.List.create({
      id: "test-list",
      title: "Test List",
      items: [
        { id: "item-1", label: "Item 1" },
        { id: "item-2", label: "Item 2" },
      ],
    })

    ViewRegistry.register("test-list", updated)
    const retrieved = ViewRegistry.get("test-list") as View.List.Info

    expect(retrieved?.items).toHaveLength(2)
  })

  test("unregisters a view", () => {
    ViewRegistry.register(
      "temp-view",
      View.Text.create({
        id: "temp-view",
        title: "Temp",
        content: "test",
      }),
    )

    expect(ViewRegistry.get("temp-view")).toBeDefined()

    ViewRegistry.unregister("temp-view")

    expect(ViewRegistry.get("temp-view")).toBeUndefined()
  })

  test("lists all registered views", () => {
    ViewRegistry.register("view-1", View.Text.create({ id: "view-1", title: "View 1", content: "" }))
    ViewRegistry.register("view-2", View.Text.create({ id: "view-2", title: "View 2", content: "" }))

    const all = ViewRegistry.list()
    expect(all).toHaveLength(2)
  })

  test("subscribes to view changes", () => {
    let changeCount = 0
    const unsub = ViewRegistry.subscribe("watched-view", () => {
      changeCount++
    })

    ViewRegistry.register("watched-view", View.Text.create({ id: "watched-view", title: "Watched", content: "v1" }))
    expect(changeCount).toBe(1)

    ViewRegistry.register("watched-view", View.Text.create({ id: "watched-view", title: "Watched", content: "v2" }))
    expect(changeCount).toBe(2)

    unsub()

    ViewRegistry.register("watched-view", View.Text.create({ id: "watched-view", title: "Watched", content: "v3" }))
    expect(changeCount).toBe(2)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/opencode/test/tui/view/registry.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// packages/opencode/src/cli/cmd/tui/view/registry.ts
import { View } from "./types"

type ViewChangeCallback = (view: View.Info) => void

const views = new Map<string, View.Info>()
const subscribers = new Map<string, Set<ViewChangeCallback>>()

export namespace ViewRegistry {
  export function register(id: string, view: View.Info): void {
    views.set(id, view)
    notifySubscribers(id, view)
  }

  export function get(id: string): View.Info | undefined {
    return views.get(id)
  }

  export function unregister(id: string): void {
    views.delete(id)
  }

  export function list(): View.Info[] {
    return Array.from(views.values())
  }

  export function clear(): void {
    views.clear()
    subscribers.clear()
  }

  export function subscribe(id: string, callback: ViewChangeCallback): () => void {
    if (!subscribers.has(id)) {
      subscribers.set(id, new Set())
    }
    subscribers.get(id)!.add(callback)

    return () => {
      subscribers.get(id)?.delete(callback)
    }
  }

  function notifySubscribers(id: string, view: View.Info): void {
    const subs = subscribers.get(id)
    if (subs) {
      for (const callback of subs) {
        callback(view)
      }
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/opencode/test/tui/view/registry.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/view/registry.ts packages/opencode/test/tui/view/registry.test.ts
git commit -m "feat(tui): add view registry for managing plugin-provided views"
```

---

## Phase 3: Window Commands

### Task 3.1: Window Command Keybinds

**Files:**

- Modify: `packages/opencode/src/config/config.ts` (add window keybinds to Keybinds schema)

**Step 1: Add window keybinds to config schema**

Add these fields to the `Keybinds` schema in `packages/opencode/src/config/config.ts` after line 576 (before the `.strict()`):

```typescript
// packages/opencode/src/config/config.ts
// Add to Keybinds schema around line 576

      // Window commands (Vim-style with <C-w> prefix)
      window_focus_left: z.string().optional().default("ctrl+w h").describe("Focus window to the left"),
      window_focus_down: z.string().optional().default("ctrl+w j").describe("Focus window below"),
      window_focus_up: z.string().optional().default("ctrl+w k").describe("Focus window above"),
      window_focus_right: z.string().optional().default("ctrl+w l").describe("Focus window to the right"),
      window_split_horizontal: z.string().optional().default("ctrl+w s").describe("Split window horizontally"),
      window_split_vertical: z.string().optional().default("ctrl+w v").describe("Split window vertically"),
      window_close: z.string().optional().default("ctrl+w c").describe("Close current window"),
      window_close_others: z.string().optional().default("ctrl+w o").describe("Close all other windows"),
      window_equalize: z.string().optional().default("ctrl+w =").describe("Equalize window sizes"),
      window_increase_height: z.string().optional().default("ctrl+w +").describe("Increase window height"),
      window_decrease_height: z.string().optional().default("ctrl+w -").describe("Decrease window height"),
      window_increase_width: z.string().optional().default("ctrl+w >").describe("Increase window width"),
      window_decrease_width: z.string().optional().default("ctrl+w <").describe("Decrease window width"),
```

**Step 2: Verify config compiles**

Run: `bun typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/opencode/src/config/config.ts
git commit -m "feat(config): add window command keybinds with Vim-style defaults"
```

---

### Task 3.2: Window Command Handler

**Files:**

- Create: `packages/opencode/src/cli/cmd/tui/context/window-commands.tsx`

**Step 1: Write the window command handler**

```typescript
// packages/opencode/src/cli/cmd/tui/context/window-commands.tsx
import { useKeyboard } from "@opentui/solid"
import { createSimpleContext } from "./helper"
import { useKeybind } from "./keybind"
import { useLayout } from "./layout"
import { useExit } from "./exit"

export const { use: useWindowCommands, provider: WindowCommandsProvider } = createSimpleContext({
  name: "WindowCommands",
  init: () => {
    const keybind = useKeybind()
    const layout = useLayout()
    const exit = useExit()

    useKeyboard((evt) => {
      // Focus navigation
      if (keybind.match("window_focus_left", evt)) {
        layout.focusDirection("left")
        return
      }
      if (keybind.match("window_focus_down", evt)) {
        layout.focusDirection("down")
        return
      }
      if (keybind.match("window_focus_up", evt)) {
        layout.focusDirection("up")
        return
      }
      if (keybind.match("window_focus_right", evt)) {
        layout.focusDirection("right")
        return
      }

      // Split commands
      if (keybind.match("window_split_horizontal", evt)) {
        const focused = layout.focusedWindow
        if (focused) {
          layout.splitHorizontal(focused.viewID)
        }
        return
      }
      if (keybind.match("window_split_vertical", evt)) {
        const focused = layout.focusedWindow
        if (focused) {
          layout.splitVertical(focused.viewID)
        }
        return
      }

      // Close commands
      if (keybind.match("window_close", evt)) {
        const closed = layout.closeWindow()
        if (!closed) {
          exit()
        }
        return
      }
      if (keybind.match("window_close_others", evt)) {
        layout.closeOtherWindows()
        return
      }

      // Resize commands
      if (keybind.match("window_equalize", evt)) {
        layout.equalizeWindows()
        return
      }
      if (keybind.match("window_increase_height", evt)) {
        layout.resizeWindow(1, "height")
        return
      }
      if (keybind.match("window_decrease_height", evt)) {
        layout.resizeWindow(-1, "height")
        return
      }
      if (keybind.match("window_increase_width", evt)) {
        layout.resizeWindow(1, "width")
        return
      }
      if (keybind.match("window_decrease_width", evt)) {
        layout.resizeWindow(-1, "width")
        return
      }
    })

    return {}
  },
})
```

**Step 2: Verify file compiles**

Run: `bun typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/context/window-commands.tsx
git commit -m "feat(tui): add window command handler for Vim-style keybinds"
```

---

## Phase 4: TUI Config Extensions

### Task 4.1: Component Visibility Config

**Files:**

- Modify: `packages/opencode/src/config/config.ts` (extend TUI schema)

**Step 1: Extend TUI config schema**

Replace the `TUI` schema in `packages/opencode/src/config/config.ts` (around line 584-596):

```typescript
// packages/opencode/src/config/config.ts
// Replace the TUI schema definition

export const TUI = z.object({
  scroll_speed: z.number().min(0.001).optional().describe("TUI scroll speed"),
  scroll_acceleration: z
    .object({
      enabled: z.boolean().describe("Enable scroll acceleration"),
    })
    .optional()
    .describe("Scroll acceleration settings"),
  diff_style: z
    .enum(["auto", "stacked"])
    .optional()
    .describe("Control diff rendering style: 'auto' adapts to terminal width, 'stacked' always shows single column"),

  // Component-specific settings
  messages: z
    .object({
      padding: z.number().int().min(0).optional().describe("Padding around messages"),
      gap: z.number().int().min(0).optional().describe("Gap between messages"),
    })
    .optional()
    .describe("Message display settings"),

  sidebar: z
    .object({
      padding: z.number().int().min(0).optional().describe("Padding inside sidebar"),
      width: z.number().int().min(10).optional().describe("Sidebar width in characters"),
      visible: z.boolean().optional().describe("Show sidebar by default"),
    })
    .optional()
    .describe("Sidebar settings"),

  header: z
    .object({
      padding: z.number().int().min(0).optional().describe("Padding inside header"),
      visible: z.boolean().optional().describe("Show header"),
      show_title: z.boolean().optional().describe("Show session title"),
      show_context: z.boolean().optional().describe("Show context info"),
      show_cost: z.boolean().optional().describe("Show cost information"),
      show_tokens: z.boolean().optional().describe("Show token count"),
    })
    .optional()
    .describe("Header settings"),

  footer: z
    .object({
      padding: z.number().int().min(0).optional().describe("Padding inside footer"),
      visible: z.boolean().optional().describe("Show footer"),
      show_directory: z.boolean().optional().describe("Show current directory"),
      show_lsp_status: z.boolean().optional().describe("Show LSP status"),
      show_mcp_status: z.boolean().optional().describe("Show MCP status"),
      show_version: z.boolean().optional().describe("Show version"),
      show_keybind_hints: z.boolean().optional().describe("Show keybind hints"),
    })
    .optional()
    .describe("Footer settings"),

  prompt: z
    .object({
      padding: z.number().int().min(0).optional().describe("Padding around prompt"),
    })
    .optional()
    .describe("Prompt settings"),

  window: z
    .object({
      padding: z.number().int().min(0).optional().describe("Padding inside windows"),
      border: z.boolean().optional().describe("Show window borders"),
    })
    .optional()
    .describe("Window settings"),
})
```

**Step 2: Verify config compiles**

Run: `bun typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/opencode/src/config/config.ts
git commit -m "feat(config): add component visibility and spacing options to TUI config"
```

---

## Phase 5: Plugin API Extensions

### Task 5.1: Window API Types

**Files:**

- Modify: `packages/plugin/src/index.ts` (add window API types)

**Step 1: Add window API types to plugin interface**

Add these types to `packages/plugin/src/index.ts` after the existing type definitions (around line 200):

```typescript
// packages/plugin/src/index.ts
// Add after existing types, before the closing of the file

// View primitive types for plugins
export type TreeNode = {
  id: string
  label: string
  icon?: string
  children: TreeNode[]
  expanded?: boolean
  metadata?: Record<string, any>
}

export type TreeView = {
  type: "tree"
  id: string
  title: string
  nodes: TreeNode[]
  selectedID?: string
}

export type ListItem = {
  id: string
  label: string
  description?: string
  icon?: string
  metadata?: Record<string, any>
}

export type ListView = {
  type: "list"
  id: string
  title: string
  items: ListItem[]
  searchable?: boolean
  selectedID?: string
}

export type TextView = {
  type: "text"
  id: string
  title: string
  content: string
  filetype?: string
}

export type FormField =
  | { id: string; type: "text"; label: string; value?: string; placeholder?: string }
  | { id: string; type: "toggle"; label: string; value?: boolean }
  | { id: string; type: "select"; label: string; options: string[]; value?: string }
  | { id: string; type: "number"; label: string; value?: number; min?: number; max?: number }

export type FormView = {
  type: "form"
  id: string
  title: string
  fields: FormField[]
}

export type PluginView = TreeView | ListView | TextView | FormView

// Window API for plugins
export type WindowAPI = {
  // Window operations
  createSplit(options: { direction: "horizontal" | "vertical"; size?: number; viewID: string }): string
  closeWindow(windowID?: string): boolean
  focusWindow(windowID: string): void
  getCurrentWindow(): { id: string; viewID: string } | undefined
  getAllWindows(): Array<{ id: string; viewID: string }>

  // View operations
  registerView(view: PluginView): void
  updateView(viewID: string, view: Partial<PluginView>): void
  unregisterView(viewID: string): void

  // Float operations
  openFloat(options: { viewID: string; x?: number; y?: number; width: number; height: number }): string
  closeFloat(floatID: string): void
}

// Keybind registration for plugins
export type KeybindAPI = {
  register(options: { key: string; description: string; scope?: "global" | "window"; handler: () => void }): () => void
}

// Extended plugin input with window API
export type PluginInputWithWindow = PluginInput & {
  window: WindowAPI
  keybind: KeybindAPI
}

// Extended hooks with window events
export interface WindowHooks {
  "window.focused"?: (input: { windowID: string; viewID: string }) => Promise<void>
  "window.closed"?: (input: { windowID: string }) => Promise<void>
  "view.action"?: (input: {
    viewID: string
    action: string
    itemID?: string
    data?: Record<string, any>
  }) => Promise<void>
}
```

**Step 2: Verify plugin types compile**

Run: `bun typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/plugin/src/index.ts
git commit -m "feat(plugin): add window and view API types for plugin system"
```

---

## Phase 6: Layout Renderer

### Task 6.1: Layout Renderer Component

**Files:**

- Create: `packages/opencode/src/cli/cmd/tui/layout/renderer.tsx`

**Step 1: Write the layout renderer**

```typescript
// packages/opencode/src/cli/cmd/tui/layout/renderer.tsx
import { For, Match, Show, Switch, createMemo, type Component } from "solid-js"
import { Dynamic } from "solid-js/web"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { useLayout } from "../context/layout"
import { Layout } from "./types"
import { ViewRegistry } from "../view/registry"
import { View } from "../view/types"

// Built-in view components
import { Session } from "../routes/session"
import { Home } from "../routes/home"

// View component registry
const VIEW_COMPONENTS: Record<string, Component<{ view?: View.Info }>> = {
  session: () => <Session />,
  home: () => <Home />,
}

// Generic view renderers for plugin views
const TreeViewRenderer: Component<{ view: View.Tree.Info }> = (props) => {
  const { theme } = useTheme()

  function renderNode(node: View.Tree.NodeInfo, depth: number) {
    const indent = "  ".repeat(depth)
    const icon = node.children.length > 0 ? (node.expanded ? "▼" : "▶") : " "

    return (
      <>
        <text fg={props.view.selectedID === node.id ? theme.accent : theme.text}>
          {indent}
          {icon} {node.icon ? `${node.icon} ` : ""}
          {node.label}
        </text>
        <Show when={node.expanded}>
          <For each={node.children}>{(child) => renderNode(child, depth + 1)}</For>
        </Show>
      </>
    )
  }

  return (
    <box flexDirection="column">
      <text fg={theme.text} bold>
        {props.view.title}
      </text>
      <For each={props.view.nodes}>{(node) => renderNode(node, 0)}</For>
    </box>
  )
}

const ListViewRenderer: Component<{ view: View.List.Info }> = (props) => {
  const { theme } = useTheme()

  return (
    <box flexDirection="column">
      <text fg={theme.text} bold>
        {props.view.title}
      </text>
      <Show when={props.view.searchable}>
        <text fg={theme.textMuted}>Search: {props.view.searchQuery ?? ""}</text>
      </Show>
      <For each={props.view.items}>
        {(item) => (
          <text fg={props.view.selectedID === item.id ? theme.accent : theme.text}>
            {item.icon ? `${item.icon} ` : ""}
            {item.label}
            <Show when={item.description}>
              <span style={{ fg: theme.textMuted }}> - {item.description}</span>
            </Show>
          </text>
        )}
      </For>
    </box>
  )
}

const TextViewRenderer: Component<{ view: View.Text.Info }> = (props) => {
  const { theme, syntax } = useTheme()

  return (
    <box flexDirection="column">
      <text fg={theme.text} bold>
        {props.view.title}
      </text>
      <Show
        when={props.view.filetype}
        fallback={<text fg={theme.text}>{props.view.content}</text>}
      >
        <code
          filetype={props.view.filetype}
          syntaxStyle={syntax()}
          content={props.view.content}
          fg={theme.text}
        />
      </Show>
    </box>
  )
}

const FormViewRenderer: Component<{ view: View.Form.Info }> = (props) => {
  const { theme } = useTheme()

  return (
    <box flexDirection="column">
      <text fg={theme.text} bold>
        {props.view.title}
      </text>
      <For each={props.view.fields}>
        {(field) => (
          <box flexDirection="row" gap={1}>
            <text fg={theme.text}>{field.label}:</text>
            <Switch>
              <Match when={field.type === "text"}>
                <text fg={theme.textMuted}>[{(field as any).value ?? (field as any).placeholder ?? ""}]</text>
              </Match>
              <Match when={field.type === "toggle"}>
                <text fg={theme.accent}>{(field as any).value ? "[x]" : "[ ]"}</text>
              </Match>
              <Match when={field.type === "select"}>
                <text fg={theme.textMuted}>[{(field as any).value ?? "select..."}]</text>
              </Match>
              <Match when={field.type === "number"}>
                <text fg={theme.textMuted}>[{(field as any).value ?? 0}]</text>
              </Match>
            </Switch>
          </box>
        )}
      </For>
    </box>
  )
}

// View renderer that dispatches to appropriate component
const ViewRenderer: Component<{ viewID: string }> = (props) => {
  const view = createMemo(() => ViewRegistry.get(props.viewID))

  return (
    <Switch>
      <Match when={VIEW_COMPONENTS[props.viewID]}>
        <Dynamic component={VIEW_COMPONENTS[props.viewID]} />
      </Match>
      <Match when={view()?.type === "tree"}>
        <TreeViewRenderer view={view() as View.Tree.Info} />
      </Match>
      <Match when={view()?.type === "list"}>
        <ListViewRenderer view={view() as View.List.Info} />
      </Match>
      <Match when={view()?.type === "text"}>
        <TextViewRenderer view={view() as View.Text.Info} />
      </Match>
      <Match when={view()?.type === "form"}>
        <FormViewRenderer view={view() as View.Form.Info} />
      </Match>
    </Switch>
  )
}

// Window renderer
const WindowRenderer: Component<{
  window: Layout.Window.Info
  width: number
  height: number
}> = (props) => {
  const { theme } = useTheme()
  const layout = useLayout()
  const focused = createMemo(() => layout.layout.focusedID === props.window.id)

  return (
    <box
      width={props.width}
      height={props.height}
      border={focused() ? ["left", "right", "top", "bottom"] : undefined}
      borderColor={focused() ? theme.borderActive : theme.border}
    >
      <ViewRenderer viewID={props.window.viewID} />
    </box>
  )
}

// Split renderer
const SplitRenderer: Component<{
  split: Layout.Split.SplitInfo
  width: number
  height: number
}> = (props) => {
  const isHorizontal = () => props.split.direction === "horizontal"

  const childDimensions = createMemo(() => {
    return props.split.children.map((_, i) => {
      const ratio = props.split.ratios[i] ?? 1 / props.split.children.length
      if (isHorizontal()) {
        return { width: props.width, height: Math.floor(props.height * ratio) }
      }
      return { width: Math.floor(props.width * ratio), height: props.height }
    })
  })

  return (
    <box flexDirection={isHorizontal() ? "column" : "row"} width={props.width} height={props.height}>
      <For each={props.split.children}>
        {(child, i) => (
          <Switch>
            <Match when={child.type === "window"}>
              <WindowRenderer
                window={child as Layout.Window.Info}
                width={childDimensions()[i()].width}
                height={childDimensions()[i()].height}
              />
            </Match>
            <Match when={child.type === "split"}>
              <SplitRenderer
                split={child as Layout.Split.SplitInfo}
                width={childDimensions()[i()].width}
                height={childDimensions()[i()].height}
              />
            </Match>
          </Switch>
        )}
      </For>
    </box>
  )
}

// Float renderer
const FloatRenderer: Component<{ float: Layout.Float.Info }> = (props) => {
  const { theme } = useTheme()
  const layout = useLayout()
  const focused = createMemo(() => layout.layout.focusedID === props.float.id)

  return (
    <box
      position="absolute"
      left={props.float.x}
      top={props.float.y}
      width={props.float.width}
      height={props.float.height}
      border={["left", "right", "top", "bottom"]}
      borderColor={focused() ? theme.borderActive : theme.border}
      backgroundColor={theme.background}
      zIndex={100}
    >
      <ViewRenderer viewID={props.float.viewID} />
    </box>
  )
}

// Main layout renderer
export const LayoutRenderer: Component = () => {
  const dimensions = useTerminalDimensions()
  const layout = useLayout()
  const { theme } = useTheme()

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background}>
      <Switch>
        <Match when={layout.layout.root.type === "window"}>
          <WindowRenderer
            window={layout.layout.root as Layout.Window.Info}
            width={dimensions().width}
            height={dimensions().height}
          />
        </Match>
        <Match when={layout.layout.root.type === "split"}>
          <SplitRenderer
            split={layout.layout.root as Layout.Split.SplitInfo}
            width={dimensions().width}
            height={dimensions().height}
          />
        </Match>
      </Switch>
      <For each={layout.layout.floats}>{(float) => <FloatRenderer float={float} />}</For>
    </box>
  )
}
```

**Step 2: Verify file compiles**

Run: `bun typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/layout/renderer.tsx
git commit -m "feat(tui): add layout renderer component for window system"
```

---

## Phase 7: Integration

### Task 7.1: Wire Up Layout System to App

**Files:**

- Modify: `packages/opencode/src/cli/cmd/tui/app.tsx`

**Step 1: Add layout providers to app**

Modify `packages/opencode/src/cli/cmd/tui/app.tsx` to include the layout system. Add imports at the top:

```typescript
// Add these imports near the top of the file (around line 22)
import { LayoutProvider } from "@tui/context/layout"
import { WindowCommandsProvider } from "@tui/context/window-commands"
```

Then wrap the App component with the new providers. Find the provider chain (around line 123-134) and add:

```typescript
// Modify the provider chain to include LayoutProvider and WindowCommandsProvider
// Insert after KeybindProvider and before PromptStashProvider

<KeybindProvider>
  <LayoutProvider>
    <WindowCommandsProvider>
      <PromptStashProvider>
        {/* ... rest of providers ... */}
      </PromptStashProvider>
    </WindowCommandsProvider>
  </LayoutProvider>
</KeybindProvider>
```

**Step 2: Verify app compiles**

Run: `bun typecheck`
Expected: No errors

**Step 3: Test manually**

Run: `bun dev` in `packages/opencode`
Expected: TUI launches without errors

**Step 4: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/app.tsx
git commit -m "feat(tui): integrate layout system into app"
```

---

### Task 7.2: Create Index Files

**Files:**

- Create: `packages/opencode/src/cli/cmd/tui/layout/index.ts`
- Create: `packages/opencode/src/cli/cmd/tui/view/index.ts`

**Step 1: Create layout index**

```typescript
// packages/opencode/src/cli/cmd/tui/layout/index.ts
export { Layout } from "./types"
export { LayoutOps } from "./operations"
export { LayoutRenderer } from "./renderer"
```

**Step 2: Create view index**

```typescript
// packages/opencode/src/cli/cmd/tui/view/index.ts
export { View } from "./types"
export { ViewRegistry } from "./registry"
```

**Step 3: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/layout/index.ts packages/opencode/src/cli/cmd/tui/view/index.ts
git commit -m "chore(tui): add index files for layout and view modules"
```

---

## Summary

This implementation plan covers:

1. **Phase 1**: Core layout primitives (types, operations, context)
2. **Phase 2**: View primitives (tree, list, text, form types and registry)
3. **Phase 3**: Window commands (keybinds and handler)
4. **Phase 4**: TUI config extensions (component visibility and spacing)
5. **Phase 5**: Plugin API extensions (window and view APIs)
6. **Phase 6**: Layout renderer (SolidJS components)
7. **Phase 7**: Integration (wiring everything together)

Each task follows TDD with:

- Failing test first
- Minimal implementation
- Verification
- Commit

Total estimated time: ~4-6 hours for an engineer with zero codebase context.
