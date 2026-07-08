import { describe, expect, test } from "bun:test"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { isSessionInTree } from "@/cli/cmd/run"

type SessionNode = { id: string; parentID?: string }

// Minimal client stub exposing only session.list, which is all isSessionInTree reads.
function client(sessions: SessionNode[]): OpencodeClient {
  return {
    session: {
      list: async () => ({ data: sessions }),
    },
  } as unknown as OpencodeClient
}

describe("isSessionInTree", () => {
  const tree = client([
    { id: "root" },
    { id: "child", parentID: "root" },
    { id: "grandchild", parentID: "child" },
    { id: "other" },
    { id: "other-child", parentID: "other" },
  ])

  test("matches the root itself without querying sessions", async () => {
    // A throwing client proves no list() call happens on the identity path.
    const throwing = {
      session: {
        list: async () => {
          throw new Error("should not query")
        },
      },
    } as unknown as OpencodeClient
    expect(await isSessionInTree(throwing, "root", "root")).toBe(true)
  })

  test("matches a direct child subagent session", async () => {
    expect(await isSessionInTree(tree, "child", "root")).toBe(true)
  })

  test("matches a nested descendant subagent session", async () => {
    expect(await isSessionInTree(tree, "grandchild", "root")).toBe(true)
  })

  test("rejects an unrelated session tree", async () => {
    expect(await isSessionInTree(tree, "other-child", "root")).toBe(false)
  })

  test("rejects an ancestor (root is not below child)", async () => {
    expect(await isSessionInTree(tree, "root", "child")).toBe(false)
  })

  test("does not loop on a cyclic parent chain", async () => {
    const cyclic = client([
      { id: "a", parentID: "b" },
      { id: "b", parentID: "a" },
    ])
    expect(await isSessionInTree(cyclic, "a", "root")).toBe(false)
  })
})
