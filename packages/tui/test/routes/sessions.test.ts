import { describe, expect, test } from "bun:test"
import { sessionsSessionOrigin, createSessionsListQuery } from "../../src/routes/sessions"

describe("sessions list", () => {
  test("requests root sessions for the default browse list", () => {
    expect(createSessionsListQuery({})).toEqual({
      roots: true,
      limit: 100,
    })
  })

  test("requests root sessions with a trimmed search term", () => {
    expect(createSessionsListQuery({ search: " deploy " })).toEqual({
      roots: true,
      limit: 30,
      search: "deploy",
    })
  })

  test("prefers the project name as the session origin", () => {
    expect(
      sessionsSessionOrigin({
        directory: "/repos/api/packages/server",
        project: { id: "p1", name: "api", worktree: "/repos/api" },
      }),
    ).toBe("api")
  })

  test("falls back to the worktree basename when the project has no name", () => {
    expect(
      sessionsSessionOrigin({
        directory: "/repos/api/packages/server",
        project: { id: "p1", worktree: "/repos/api" },
      }),
    ).toBe("api")
  })

  test("falls back to the session directory basename without project info", () => {
    expect(sessionsSessionOrigin({ directory: "/repos/api", project: null })).toBe("api")
  })
})
