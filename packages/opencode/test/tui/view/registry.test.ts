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
