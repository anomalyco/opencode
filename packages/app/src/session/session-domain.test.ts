import { describe, expect, test } from "bun:test"
import { removedSessionIDs } from "./session-domain"

describe("removedSessionIDs", () => {
  test("includes all descendants without unrelated sessions", () => {
    const sessions = [
      { id: "root" },
      { id: "child", parentID: "root" },
      { id: "grandchild", parentID: "child" },
      { id: "other" },
    ]

    expect([...removedSessionIDs(sessions, "root")]).toEqual(["root", "child", "grandchild"])
  })
})
