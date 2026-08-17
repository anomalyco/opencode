import { describe, expect, test } from "bun:test"
import { firstChild, isDefaultTitle } from "../../src/util/session"

describe("util.session", () => {
  test("finds a direct child from a nested session", () => {
    const sessions = [
      { id: "root" },
      { id: "child-a", parentID: "root" },
      { id: "child-b", parentID: "root" },
      { id: "grandchild", parentID: "child-b" },
    ]

    expect(firstChild(sessions, sessions[2])).toEqual(sessions[3])
  })

  test("recognizes generated parent and child titles", () => {
    expect(isDefaultTitle("New session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("Child session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("New session - custom")).toBeFalse()
  })
})
