import { describe, expect, test } from "bun:test"
import {
  getCurrentSessionWithChildren,
  getFirstDirectChildSession,
  getSiblingSessions,
} from "../../../src/cli/cmd/tui/routes/session/navigation"

describe("getCurrentSessionWithChildren", () => {
  test("returns the root session and its direct children", () => {
    const sessions = [
      { id: "root" },
      { id: "child-b", parentID: "root" },
      { id: "grandchild", parentID: "child-a" },
      { id: "child-a", parentID: "root" },
    ]

    expect(getCurrentSessionWithChildren(sessions, "root")).toEqual([
      { id: "child-a", parentID: "root" },
      { id: "child-b", parentID: "root" },
      { id: "root" },
    ])
  })

  test("returns the current child session and its direct children", () => {
    const sessions = [
      { id: "root" },
      { id: "child-a", parentID: "root" },
      { id: "child-b", parentID: "root" },
      { id: "grandchild-b", parentID: "child-a" },
      { id: "grandchild-a", parentID: "child-a" },
    ]

    expect(getCurrentSessionWithChildren(sessions, "child-a")).toEqual([
      { id: "child-a", parentID: "root" },
      { id: "grandchild-a", parentID: "child-a" },
      { id: "grandchild-b", parentID: "child-a" },
    ])
  })

  test("returns an empty list when the current session is missing", () => {
    expect(getCurrentSessionWithChildren([{ id: "root" }], undefined)).toEqual([])
  })
})

describe("getFirstDirectChildSession", () => {
  test("preserves first-level descent from the root session", () => {
    const sessions = [
      { id: "root" },
      { id: "child-b", parentID: "root" },
      { id: "child-a", parentID: "root" },
    ]

    const visibleSessions = getCurrentSessionWithChildren(sessions, "root")

    expect(getFirstDirectChildSession(visibleSessions, "root")).toEqual({
      id: "child-a",
      parentID: "root",
    })
  })

  test("nested descent skips the current child session and selects its direct child", () => {
    const sessions = [
      { id: "root" },
      { id: "child-a", parentID: "root" },
      { id: "child-b", parentID: "root" },
      { id: "grandchild-b", parentID: "child-a" },
      { id: "grandchild-a", parentID: "child-a" },
    ]

    const visibleSessions = getCurrentSessionWithChildren(sessions, "child-a")

    expect(getFirstDirectChildSession(visibleSessions, "child-a")).toEqual({
      id: "grandchild-a",
      parentID: "child-a",
    })
  })

  test("returns nothing when there are no direct children", () => {
    const visibleSessions = getCurrentSessionWithChildren([{ id: "root" }], "root")

    expect(getFirstDirectChildSession(visibleSessions, "root")).toBeUndefined()
  })
})

describe("getSiblingSessions", () => {
  test("keeps sibling cycling scoped to the current depth", () => {
    const sessions = [
      { id: "root" },
      { id: "child-b", parentID: "root" },
      { id: "child-a", parentID: "root" },
      { id: "grandchild-a", parentID: "child-a" },
    ]

    expect(getSiblingSessions(sessions, { id: "child-a", parentID: "root" })).toEqual([
      { id: "child-a", parentID: "root" },
      { id: "child-b", parentID: "root" },
    ])
  })

  test("returns an empty list for the root session", () => {
    expect(getSiblingSessions([{ id: "root" }], { id: "root" })).toEqual([])
  })
})
