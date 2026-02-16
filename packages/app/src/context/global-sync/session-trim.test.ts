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
  test("keeps the most recently updated sessions regardless of parent", () => {
    const now = 50_000_000
    const list = [
      session({ id: "a-root-old", created: now - 30_000_000 }),
      session({ id: "b-child-new", parentID: "a-root-old", created: now - 1_000 }),
      session({ id: "c-root-new", created: now - 2_000 }),
      session({ id: "d-child-old", parentID: "a-root-old", created: now - 20_000_000 }),
      session({ id: "e-archived", created: now - 500, archived: now - 10 }),
    ]

    const result = trimSessions(list, { limit: 2, permission: {}, now })
    expect(result.map((x) => x.id)).toEqual(["b-child-new", "c-root-new"])
  })

  test("keeps permission-request sessions even when they are outside the recency limit", () => {
    const now = 50_000_000
    const list = [
      session({ id: "a-new", created: now - 1_000 }),
      session({ id: "b-new", created: now - 2_000 }),
      session({ id: "c-old-permission", created: now - 25_000_000 }),
      session({ id: "d-old-trimmed", created: now - 26_000_000 }),
    ]

    const result = trimSessions(list, {
      limit: 2,
      permission: {
        "c-old-permission": [{ id: "perm-1" } as PermissionRequest],
      },
      now,
    })

    expect(result.map((x) => x.id)).toEqual(["a-new", "b-new", "c-old-permission"])
  })

  test("deduplicates sessions by id using the newest copy", () => {
    const now = 50_000_000
    const list = [
      session({ id: "a", created: now - 30_000_000 }),
      session({ id: "a", created: now - 30_000_000, updated: now - 500 }),
      session({ id: "b", created: now - 1_000 }),
    ]

    const result = trimSessions(list, { limit: 2, permission: {}, now })
    expect(result.map((x) => x.id)).toEqual(["a", "b"])
  })
})
