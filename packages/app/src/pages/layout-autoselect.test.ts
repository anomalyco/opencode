import { describe, expect, test } from "bun:test"
import { selectAutoselectProject } from "./layout-autoselect"

describe("selectAutoselectProject", () => {
  test("prefers the server's launch directory over a stale last-project value", () => {
    // Regression test for https://github.com/anomalyco/opencode/issues/49947:
    // `last` is a browser-local value keyed only by server host:port, so a WSL server
    // reusing the default port could resurrect a stale home-directory project from an
    // unrelated launch instead of staying on the directory it was actually started from.
    const next = selectAutoselectProject({
      list: [{ worktree: "/home/user" }, { worktree: "/mnt/c/Projects/UI-MCP" }],
      last: "/home/user",
      launchDirectory: "/mnt/c/Projects/UI-MCP",
    })
    expect(next).toBe("/mnt/c/Projects/UI-MCP")
  })

  test("falls back to the last-project value when the launch directory isn't recognized yet", () => {
    const next = selectAutoselectProject({
      list: [{ worktree: "/home/user" }],
      last: "/home/user",
      launchDirectory: undefined,
    })
    expect(next).toBe("/home/user")
  })

  test("falls back to the first project when there is no last-project value", () => {
    const next = selectAutoselectProject({
      list: [{ worktree: "/mnt/c/Projects/UI-MCP" }],
      last: undefined,
      launchDirectory: undefined,
    })
    expect(next).toBe("/mnt/c/Projects/UI-MCP")
  })

  test("returns the last-project value directly when no projects are synced yet", () => {
    const next = selectAutoselectProject({
      list: [],
      last: "/mnt/c/Projects/UI-MCP",
      launchDirectory: "/mnt/c/Projects/UI-MCP",
    })
    expect(next).toBe("/mnt/c/Projects/UI-MCP")
  })

  test("returns undefined when there is nothing to select", () => {
    const next = selectAutoselectProject({ list: [], last: undefined, launchDirectory: undefined })
    expect(next).toBeUndefined()
  })
})
