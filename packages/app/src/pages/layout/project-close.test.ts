import { describe, expect, test } from "bun:test"
import { closeProject, projectCloseBody } from "./project-close"

const t = (key: string, vars?: Record<string, string | number>) => {
  if (key === "dialog.project.close.note") return "Reopen later."
  if (key === "dialog.project.close.sessions.one") return "1 active session."
  if (key === "dialog.project.close.sessions.many") return `${vars?.count} active sessions.`
  return key
}

describe("project close copy", () => {
  test("shows note when there are no active sessions", () => {
    expect(projectCloseBody(0, t)).toBe("Reopen later.")
  })

  test("shows singular session warning with note", () => {
    expect(projectCloseBody(1, t)).toBe("1 active session. Reopen later.")
  })

  test("shows plural session warning with note", () => {
    expect(projectCloseBody(3, t)).toBe("3 active sessions. Reopen later.")
  })
})

describe("closeProject", () => {
  test("closes inactive project without navigation", () => {
    const calls = { close: [] as string[], nav: [] as string[], open: [] as string[] }
    closeProject({
      directory: "/b",
      list: [
        { worktree: "/a", expanded: false },
        { worktree: "/b", expanded: false },
      ],
      current: "/a",
      close: (directory) => calls.close.push(directory),
      navigate: (href) => calls.nav.push(href),
      open: (directory) => {
        calls.open.push(directory)
      },
    })
    expect(calls).toEqual({ close: ["/b"], nav: [], open: [] })
  })

  test("navigates home when closing the active last project", () => {
    const calls = { close: [] as string[], nav: [] as string[], open: [] as string[] }
    closeProject({
      directory: "/a",
      list: [{ worktree: "/a", expanded: false }],
      current: "/a",
      close: (directory) => calls.close.push(directory),
      navigate: (href) => calls.nav.push(href),
      open: (directory) => {
        calls.open.push(directory)
      },
    })
    expect(calls).toEqual({ close: ["/a"], nav: ["/"], open: [] })
  })
})
