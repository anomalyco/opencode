import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2"
import { collectSubtree } from "../../../src/routes/session"

const s = (input: { id: string; parentID?: string }) =>
  ({
    id: input.id,
    parentID: input.parentID,
    title: input.id,
  }) as Session

describe("collectSubtree", () => {
  test("returns only root when there are no children", () => {
    const result = collectSubtree([s({ id: "root" })], "root")
    expect(result.map((x) => x.id)).toEqual(["root"])
  })

  test("returns root with direct children", () => {
    const sessions = [s({ id: "root" }), s({ id: "child-1", parentID: "root" }), s({ id: "child-2", parentID: "root" })]
    const result = collectSubtree(sessions, "root")
    expect(result.map((x) => x.id).sort()).toEqual(["child-1", "child-2", "root"])
    expect(result[0].id).toBe("root")
  })

  test("returns the full chain for a three-level tree", () => {
    const sessions = [
      s({ id: "root" }),
      s({ id: "child", parentID: "root" }),
      s({ id: "grandchild", parentID: "child" }),
    ]
    const result = collectSubtree(sessions, "root")
    expect(result.map((x) => x.id).sort()).toEqual(["child", "grandchild", "root"])
    expect(result[0].id).toBe("root")
  })

  test("does not cross sibling branches", () => {
    const sessions = [
      s({ id: "root" }),
      s({ id: "child-1", parentID: "root" }),
      s({ id: "grandchild-1", parentID: "child-1" }),
      s({ id: "child-2", parentID: "root" }),
      s({ id: "grandchild-2", parentID: "child-2" }),
    ]
    expect(collectSubtree(sessions, "root").map((x) => x.id).sort()).toEqual(
      ["child-1", "child-2", "grandchild-1", "grandchild-2", "root"],
    )
    expect(collectSubtree(sessions, "child-1").map((x) => x.id).sort()).toEqual(["child-1", "grandchild-1"])
  })

  test("includes root itself in the result", () => {
    const sessions = [s({ id: "root" }), s({ id: "child", parentID: "root" })]
    const ids = collectSubtree(sessions, "root").map((x) => x.id)
    expect(ids).toContain("root")
  })

  test("returns empty array when root is missing", () => {
    expect(collectSubtree([s({ id: "child", parentID: "root" })], "root")).toEqual([])
  })

  test("does not loop forever on a parentID cycle", () => {
    const sessions = [
      s({ id: "root", parentID: "child" }),
      s({ id: "child", parentID: "root" }),
    ]
    const ids = collectSubtree(sessions, "root").map((x) => x.id)
    expect(ids).toContain("root")
    expect(ids).toContain("child")
    expect(new Set(ids).size).toBe(ids.length)
  })
})
