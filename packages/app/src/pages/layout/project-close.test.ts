import { describe, expect, test } from "bun:test"
import { closeProject } from "./project-close"

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
