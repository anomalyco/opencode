import { describe, expect, test } from "bun:test"

const { getDirectChildSessions, getSiblingSessions, shouldRenderSessionPrompt } = await import(
  "../../../src/cli/cmd/tui/routes/session/navigation"
)

describe("session navigation helpers", () => {
  const sessions = [
    { id: "root" },
    { id: "child-a", parentID: "root" },
    { id: "child-b", parentID: "root" },
    { id: "grandchild-a", parentID: "child-a" },
  ]

  test("collects only direct children for the active session", () => {
    expect(getDirectChildSessions(sessions, "root").map((session) => session.id)).toEqual(["child-a", "child-b"])
    expect(getDirectChildSessions(sessions, "child-a").map((session) => session.id)).toEqual(["grandchild-a"])
  })

  test("collects sibling sessions for subagent cycling", () => {
    expect(getSiblingSessions(sessions, sessions[1]).map((session) => session.id)).toEqual(["child-a", "child-b"])
    expect(getSiblingSessions(sessions, sessions[0])).toEqual([])
  })

  test("only renders the prompt for root sessions without blocking UI", () => {
    expect(shouldRenderSessionPrompt({ session: sessions[0], permissionCount: 0, questionCount: 0 })).toBe(true)
    expect(shouldRenderSessionPrompt({ session: sessions[1], permissionCount: 0, questionCount: 0 })).toBe(false)
    expect(shouldRenderSessionPrompt({ session: sessions[0], permissionCount: 1, questionCount: 0 })).toBe(false)
  })
})
