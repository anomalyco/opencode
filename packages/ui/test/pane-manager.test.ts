import { describe, expect, test } from "bun:test"
import { createPaneManager } from "../src/context/pane-manager"

describe("pane manager", () => {
  test("container hierarchy is ordered", async () => {
    const pane = createPaneManager()
    await pane.createContainer("workspace")
    await pane.createContainer("tab-1", "workspace")
    await pane.createContainer("tab-2", "workspace")
    await pane.createContainer("tab-3", "workspace")

    expect(await pane.getChildren("workspace")).toEqual(["tab-1", "tab-2", "tab-3"])

    await pane.reorderContainers("workspace", ["tab-3", "tab-1", "tab-2"])
    expect(await pane.getChildren("workspace")).toEqual(["tab-3", "tab-1", "tab-2"])
  })

  test("split + resize changes render tree", async () => {
    const pane = createPaneManager<{ title?: string }>()
    await pane.createContainer("tab")
    await pane.createNode("tab", "pane-1", { title: "A" })

    const splitId = await pane.splitNode("tab", "pane-1", "pane-2", "v", { title: "B" })
    expect(splitId).toStartWith("split-")

    const tree0 = await pane.getRenderTree("tab")
    expect(tree0.root?.type).toBe("split")

    await pane.resizeSplit("tab", splitId, 0.25)
    const tree1 = await pane.getRenderTree("tab")
    expect(tree1.root?.type).toBe("split")
    expect(tree1.root?.children?.[0].rect.width).toBeCloseTo(25, 6)
  })

  test("delete rebalances to remaining leaf", async () => {
    const pane = createPaneManager()
    await pane.createContainer("tab")
    await pane.createNode("tab", "pane-1")
    await pane.splitNode("tab", "pane-1", "pane-2", "h")

    await pane.deleteNode("tab", "pane-2")
    const tree = await pane.getRenderTree("tab")
    expect(tree.root?.type).toBe("leaf")
    expect(tree.root?.id).toBe("pane-1")
  })

  test("moveNode defaults to splitting focused leaf", async () => {
    const pane = createPaneManager()
    await pane.createContainer("a")
    await pane.createContainer("b")

    await pane.createNode("a", "pane-1")
    await pane.createNode("b", "pane-2")

    await pane.focusContainer("b")
    await pane.focusNode("b", "pane-2")

    await pane.moveNode("pane-1", "a", "b")
    const tree = await pane.getRenderTree("b")
    expect(tree.root?.type).toBe("split")
    const ids = (await pane.getAllNodes("b")).map((n) => n.id).sort()
    expect(ids).toEqual(["pane-1", "pane-2"])
  })

  test("navigate finds adjacent pane", async () => {
    const pane = createPaneManager()
    await pane.createContainer("tab")
    await pane.createNode("tab", "pane-1")
    await pane.splitNode("tab", "pane-1", "pane-2", "v")

    const next = await pane.navigate("tab", "pane-1", "right")
    expect(next).toBe("pane-2")
  })

  test("onLayoutChange emits on mutations", async () => {
    const pane = createPaneManager()
    await pane.createContainer("tab")

    let n = 0
    const off = pane.onLayoutChange("tab", () => {
      n += 1
    })

    await pane.createNode("tab", "pane-1")
    await pane.splitNode("tab", "pane-1", "pane-2", "v")
    off()
    await pane.deleteNode("tab", "pane-2")

    expect(n).toBeGreaterThanOrEqual(3)
  })
})

