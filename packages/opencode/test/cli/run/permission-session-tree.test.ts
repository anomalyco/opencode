import { describe, expect, test } from "bun:test"
import { isSessionInTree } from "@/cli/cmd/run"

type Node = { id: string; parentID?: string }

function parent(nodes: Node[], calls: string[] = []) {
  const sessions = new Map(nodes.map((node) => [node.id, node]))
  return async (sessionID: string) => {
    calls.push(sessionID)
    return sessions.get(sessionID)?.parentID
  }
}

describe("run permission session tree", () => {
  const nodes = [
    { id: "root" },
    { id: "child", parentID: "root" },
    { id: "grandchild", parentID: "child" },
    { id: "other" },
    { id: "other-child", parentID: "other" },
  ]

  test("matches the root without loading a session", async () => {
    const calls: string[] = []
    expect(await isSessionInTree(parent(nodes, calls), "root", new Set(["root"]))).toBe(true)
    expect(calls).toEqual([])
  })

  test("matches descendants and caches their lineage", async () => {
    const calls: string[] = []
    const sessions = new Set(["root"])
    const lookup = parent(nodes, calls)

    expect(await isSessionInTree(lookup, "grandchild", sessions)).toBe(true)
    expect(calls).toEqual(["grandchild", "child"])
    expect(sessions).toEqual(new Set(["root", "grandchild", "child"]))

    calls.length = 0
    expect(await isSessionInTree(lookup, "grandchild", sessions)).toBe(true)
    expect(calls).toEqual([])
  })

  test("rejects unrelated and cyclic session trees", async () => {
    expect(await isSessionInTree(parent(nodes), "other-child", new Set(["root"]))).toBe(false)
    expect(
      await isSessionInTree(
        parent([
          { id: "a", parentID: "b" },
          { id: "b", parentID: "a" },
        ]),
        "a",
        new Set(["root"]),
      ),
    ).toBe(false)
  })

  test("propagates session lookup failures", async () => {
    const lookup = async () => {
      throw new Error("lookup failed")
    }
    let caught: unknown
    try {
      await isSessionInTree(lookup, "child", new Set(["root"]))
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Error)
    if (!(caught instanceof Error)) throw new Error("expected lookup to fail")
    expect(caught.message).toBe("lookup failed")
  })
})
