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
