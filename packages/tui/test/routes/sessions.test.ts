import { describe, expect, test } from "bun:test"
import path from "path"
import { parseNewSessionInput, sessionsSessionOrigin, createSessionsListQuery } from "../../src/routes/sessions"

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

  test("falls back to the directory basename when the worktree is the filesystem root", () => {
    expect(
      sessionsSessionOrigin({
        directory: "/tmp",
        project: { id: "global", worktree: "/" },
      }),
    ).toBe("tmp")
  })
})

describe("parseNewSessionInput", () => {
  const paths = { cwd: "/work/current", home: "/home/user" }

  test("treats plain text as a prompt in the current directory", () => {
    expect(parseNewSessionInput("fix the bug", paths)).toEqual({ directory: undefined, prompt: "fix the bug" })
  })

  test("trims surrounding whitespace", () => {
    expect(parseNewSessionInput("  hello  ", paths)).toEqual({ directory: undefined, prompt: "hello" })
  })

  test("extracts an absolute @path without a prompt", () => {
    expect(parseNewSessionInput("@/repos/api", paths)).toEqual({ directory: "/repos/api", prompt: "" })
  })

  test("extracts an absolute @path with a prompt", () => {
    expect(parseNewSessionInput("@/repos/api run the tests", paths)).toEqual({
      directory: "/repos/api",
      prompt: "run the tests",
    })
  })

  test("expands ~ against the home directory", () => {
    expect(parseNewSessionInput("@~/proj x", paths)).toEqual({ directory: path.join("/home/user", "proj"), prompt: "x" })
  })

  test("resolves a relative @path against the cwd", () => {
    expect(parseNewSessionInput("@packages/tui", paths)).toEqual({
      directory: path.resolve("/work/current", "packages/tui"),
      prompt: "",
    })
  })

  test("a lone @ is kept as prompt text", () => {
    expect(parseNewSessionInput("@ not-a-path", paths)).toEqual({ directory: undefined, prompt: "@ not-a-path" })
  })
})
