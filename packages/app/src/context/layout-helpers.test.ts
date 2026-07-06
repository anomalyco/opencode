import { describe, expect, test } from "bun:test"
import { sandboxRoots } from "./layout-helpers"

describe("sandboxRoots", () => {
  test("maps non-global project sandboxes to their root worktree", () => {
    const result = sandboxRoots([
      { id: "project-a", worktree: "/repos/a", sandboxes: ["/repos/a/worktrees/feature-1", "/repos/a/worktrees/feature-2"] },
      { id: "project-b", worktree: "/repos/b", sandboxes: ["/repos/b/worktrees/feature-1"] },
    ])

    expect(result.get("/repos/a/worktrees/feature-1")).toBe("/repos/a")
    expect(result.get("/repos/a/worktrees/feature-2")).toBe("/repos/a")
    expect(result.get("/repos/b/worktrees/feature-1")).toBe("/repos/b")
  })

  test("ignores global project sandboxes", () => {
    const result = sandboxRoots([
      { id: "global", worktree: "/", sandboxes: ["/dir-a/client", "/dir-b/client"] },
      { id: "project-a", worktree: "/repos/a", sandboxes: ["/repos/a/worktrees/feature-1"] },
    ])

    expect(result.get("/dir-a/client")).toBeUndefined()
    expect(result.get("/dir-b/client")).toBeUndefined()
    expect(result.get("/repos/a/worktrees/feature-1")).toBe("/repos/a")
  })
})
