import { expect, test } from "bun:test"
import { projectAgentTree } from "./agent-tree"
import { nativeFixture } from "./fixtures"
import type { NativeRecord } from "./native-types"

test("a grandchild resolves to its real root and idle is not completion", () => {
  const view = projectAgentTree("grandchild", nativeFixture())
  expect(view.rootSessionID).toBe("root")
  expect(view.nodes.map((node) => node.id)).toEqual(["root", "child", "idle-child", "grandchild"])
  expect(view.nodes.find((node) => node.id === "idle-child")?.status).toBe("idle")
  expect(view.complete).toBe(true)
})

test("an unknown ancestor is incomplete and is not treated as the selected child's root", () => {
  const view = projectAgentTree(
    "grandchild",
    nativeFixture().filter((node) => node.id !== "root"),
  )
  expect(view.rootSessionID).toBeUndefined()
  expect(view.missingParentID).toBe("root")
  expect(view.complete).toBe(false)
  expect(view.nodes.map((node) => node.id)).toEqual(["grandchild"])
})

test("a deleted child stays as an unknown placeholder and keeps the tree partial", () => {
  const view = projectAgentTree("root", [
    ...nativeFixture().filter((node) => node.id !== "grandchild"),
    {
      id: "grandchild",
      parentID: "child",
      title: "Grandchild worker",
      directory: "/root/git/demo/.worktrees/feature",
      status: "unknown",
      needsInput: false,
      error: "session not found",
    },
  ])
  expect(view.rootSessionID).toBe("root")
  expect(view.nodes.map((node) => node.id)).toEqual(["root", "child", "idle-child", "grandchild"])
  expect(view.nodes.find((node) => node.id === "grandchild")?.status).toBe("unknown")
  expect(view.nodes.find((node) => node.id === "grandchild")?.error).toBe("session not found")
  expect(view.complete).toBe(false)
})

test("malformed cyclic parent data terminates and stays incomplete", () => {
  const view = projectAgentTree("child", [
    { id: "root", parentID: "child", title: "Root", directory: "/root/git/demo", status: "idle", needsInput: false },
    { id: "child", parentID: "root", title: "Child", directory: "/root/git/demo", status: "idle", needsInput: false },
  ])
  expect(view.rootSessionID).toBeUndefined()
  expect(view.complete).toBe(false)
})

test("a selected session absent from the records is incomplete", () => {
  const view = projectAgentTree("missing", nativeFixture())
  expect(view.rootSessionID).toBeUndefined()
  expect(view.missingParentID).toBe("missing")
  expect(view.nodes.map((node) => node.id)).toEqual([])
  expect(view.complete).toBe(false)
})

test("a root with no children is complete", () => {
  const [root] = nativeFixture()
  const view = projectAgentTree("root", [root])
  expect(view.rootSessionID).toBe("root")
  expect(view.nodes.map((node) => node.id)).toEqual(["root"])
  expect(view.complete).toBe(true)
})

test("an unreachable record keeps the projection incomplete", () => {
  const orphan: NativeRecord = {
    id: "orphan",
    parentID: "other-root",
    title: "Orphan",
    directory: "/root/git/other",
    status: "idle",
    needsInput: false,
  }
  const view = projectAgentTree("root", [...nativeFixture(), orphan])
  expect(view.rootSessionID).toBe("root")
  expect(view.complete).toBe(false)
  expect(view.nodes.map((node) => node.id)).not.toContain("orphan")
})
