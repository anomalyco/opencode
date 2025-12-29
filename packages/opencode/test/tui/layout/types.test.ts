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
        { type: "window", id: "win-1", viewID: "session", focused: false },
        { type: "window", id: "win-2", viewID: "home", focused: false },
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
      root: { type: "window", id: "win-1", viewID: "session", focused: false },
      floats: [],
      focusedID: "win-1",
    })
    expect(root.focusedID).toBe("win-1")
    expect(root.floats).toHaveLength(0)
  })
})
