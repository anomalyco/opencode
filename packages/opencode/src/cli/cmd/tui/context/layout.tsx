// packages/opencode/src/cli/cmd/tui/context/layout.tsx
import { createMemo } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { Layout } from "../layout/types"
import { LayoutOps } from "../layout/operations"
import { WindowFocusRegistry } from "../window-focus-registry"

export const { use: useLayout, provider: LayoutProvider } = createSimpleContext({
  name: "Layout",
  init: () => {
    const [layout, setLayout] = createStore<Layout.Root.Info>({
      root: Layout.Window.create({ id: "win-main", viewID: "home" }),
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
        WindowFocusRegistry.focus(newID)
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
        WindowFocusRegistry.focus(newID)
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
        WindowFocusRegistry.focus(windowID)
      },

      focusDirection(direction: "left" | "right" | "up" | "down") {
        const result = LayoutOps.focusDirection(layout, direction)
        if (result.focusedID !== layout.focusedID) {
          setLayout("focusedID", result.focusedID)
          WindowFocusRegistry.focus(result.focusedID)
        }
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

      // Navigate the focused window to a new view
      navigateFocusedWindow(viewID: string) {
        const windowID = layout.focusedID
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
        // Focus the window's prompt after view change
        WindowFocusRegistry.focus(windowID)
      },
    }
  },
})
