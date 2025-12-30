// packages/opencode/src/cli/cmd/tui/layout/operations.ts
import { Layout } from "./types"

export namespace LayoutOps {
  export const generateID = (() => {
    const counter = { value: 0 }
    return (prefix: string): string => `${prefix}-${++counter.value}`
  })()

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

      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]
        const result = removeFromNode(child)
        if (result !== null) {
          newChildren.push(result)
          newRatios.push(node.ratios[i])
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

    // Find path from root to target window
    function findPath(node: Layout.Node, targetID: string, path: Layout.Node[] = []): Layout.Node[] | null {
      if (node.type === "window") {
        return node.id === targetID ? [...path, node] : null
      }
      for (const child of node.children) {
        const found = findPath(child, targetID, [...path, node])
        if (found) return found
      }
      return null
    }

    // Check if direction matches split orientation
    function directionMatchesSplit(dir: "left" | "right" | "up" | "down", split: Layout.Split.SplitInfo): boolean {
      if (split.direction === "vertical") return dir === "left" || dir === "right"
      return dir === "up" || dir === "down"
    }

    // Get sibling in direction within a split
    function getSiblingInSplit(
      split: Layout.Split.SplitInfo,
      childNode: Layout.Node,
      dir: "left" | "right" | "up" | "down",
    ): Layout.Node | null {
      const idx = split.children.indexOf(childNode)
      if (idx === -1) return null

      const goForward = dir === "right" || dir === "down"
      const nextIdx = goForward ? idx + 1 : idx - 1

      if (nextIdx < 0 || nextIdx >= split.children.length) return null
      return split.children[nextIdx]
    }

    const path = findPath(root.root, root.focusedID)
    if (!path || path.length === 0) return root

    // Walk up the path to find a split where we can move in the desired direction
    for (let i = path.length - 2; i >= 0; i--) {
      const node = path[i]
      if (node.type !== "split") continue

      if (!directionMatchesSplit(direction, node)) continue

      const childInPath = path[i + 1]
      const sibling = getSiblingInSplit(node, childInPath, direction)

      if (sibling) {
        const goForward = direction === "right" || direction === "down"
        const newFocusedID = goForward ? getFirstWindow(sibling) : getLastWindow(sibling)
        if (newFocusedID) {
          return { ...root, focusedID: newFocusedID }
        }
      }
    }

    return root
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
