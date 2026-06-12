import { describe, expect, test } from "bun:test"
import type { PermissionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { trimSessions } from "./session-trim"

const session = (input: { id: string; parentID?: string; created: number; updated?: number; archived?: number }) =>
  ({
    id: input.id,
    parentID: input.parentID,
    time: {
      created: input.created,
      updated: input.updated,
      archived: input.archived,
    },
  }) as Session

describe("trimSessions", () => {
  test("keeps base roots and recent roots beyond the limit", () => {
    const now = 1_000_000
    const list = [
      session({ id: "a", created: now - 100_000 }),
      session({ id: "b", created: now - 90_000 }),
      session({ id: "c", created: now - 80_000 }),
      session({ id: "d", created: now - 70_000, updated: now - 1_000 }),
      session({ id: "e", created: now - 60_000, archived: now - 10 }),
    ]

    const result = trimSessions(list, { limit: 2, permission: {}, now })
    expect(result.map((x) => x.id)).toEqual(["a", "b", "c", "d"])
  })

  test("keeps children when root is kept, permission exists, or child is recent", () => {
    const now = 1_000_000
    const list = [
      session({ id: "root-1", created: now - 1000 }),
      session({ id: "root-2", created: now - 2000 }),
      session({ id: "z-root", created: now - 30_000_000 }),
      session({ id: "child-kept-by-root", parentID: "root-1", created: now - 20_000_000 }),
      session({ id: "child-kept-by-permission", parentID: "z-root", created: now - 20_000_000 }),
      session({ id: "child-kept-by-recency", parentID: "z-root", created: now - 500 }),
      session({ id: "child-trimmed", parentID: "z-root", created: now - 20_000_000 }),
    ]

    const result = trimSessions(list, {
      limit: 2,
      permission: {
        "child-kept-by-permission": [{ id: "perm-1" } as PermissionRequest],
      },
      now,
    })

    expect(result.map((x) => x.id)).toEqual([
      "child-kept-by-permission",
      "child-kept-by-recency",
      "child-kept-by-root",
      "root-1",
      "root-2",
    ])
  })

  test("keeps descendants of a kept root transitively", () => {
    const now = 1_000_000
    const old = now - 20_000_000
    const list = [
      session({ id: "root-1", created: now - 1000 }),
      session({ id: "child", parentID: "root-1", created: old }),
      session({ id: "grandchild", parentID: "child", created: old }),
      session({ id: "great-grandchild", parentID: "grandchild", created: old }),
    ]

    const result = trimSessions(list, { limit: 2, permission: {}, now })
    expect(result.map((x) => x.id)).toEqual(["child", "grandchild", "great-grandchild", "root-1"])
  })

  test("trims descendants of a trimmed root transitively", () => {
    const now = 1_000_000
    const old = now - 20_000_000
    const list = [
      session({ id: "root-1", created: now - 1000 }),
      session({ id: "root-2", created: now - 2000 }),
      session({ id: "z-root", created: now - 30_000_000 }),
      session({ id: "z-child", parentID: "z-root", created: old }),
      session({ id: "z-grandchild", parentID: "z-child", created: old }),
    ]

    const result = trimSessions(list, { limit: 2, permission: {}, now })
    expect(result.map((x) => x.id)).toEqual(["root-1", "root-2"])
  })

  test("permission and recency still keep deep children of a trimmed root", () => {
    const now = 1_000_000
    const old = now - 20_000_000
    const list = [
      session({ id: "root-1", created: now - 1000 }),
      session({ id: "root-2", created: now - 2000 }),
      session({ id: "z-root", created: now - 30_000_000 }),
      session({ id: "z-child", parentID: "z-root", created: old }),
      session({ id: "z-grandchild-permission", parentID: "z-child", created: old }),
      session({ id: "z-grandchild-recent", parentID: "z-child", created: now - 500 }),
      session({ id: "z-grandchild-trimmed", parentID: "z-child", created: old }),
    ]

    const result = trimSessions(list, {
      limit: 2,
      permission: {
        "z-grandchild-permission": [{ id: "perm-1" } as PermissionRequest],
      },
      now,
    })
    expect(result.map((x) => x.id)).toEqual(["root-1", "root-2", "z-grandchild-permission", "z-grandchild-recent"])
  })

  test("drops old orphan children whose parent chain never reaches a kept root", () => {
    const now = 1_000_000
    const old = now - 20_000_000
    const list = [
      session({ id: "root-1", created: now - 1000 }),
      session({ id: "orphan", parentID: "missing-parent", created: old }),
      session({ id: "orphan-child", parentID: "orphan", created: old }),
    ]

    const result = trimSessions(list, { limit: 2, permission: {}, now })
    expect(result.map((x) => x.id)).toEqual(["root-1"])
  })

  test("does not hang on a parentID cycle", () => {
    const now = 1_000_000
    const old = now - 20_000_000
    const list = [
      session({ id: "root-1", created: now - 1000 }),
      session({ id: "cycle-a", parentID: "cycle-b", created: old }),
      session({ id: "cycle-b", parentID: "cycle-a", created: old }),
    ]

    const result = trimSessions(list, { limit: 2, permission: {}, now })
    expect(result.map((x) => x.id)).toEqual(["root-1"])
  })
})
