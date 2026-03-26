import { describe, expect, test } from "bun:test"
import { projectForDirectory, sandboxRoots } from "./project"

describe("utils.project", () => {
  test("prefers a direct worktree match over a sandbox match", () => {
    const projects = [
      { worktree: "/root", sandboxes: ["/root/deps/right"] },
      { worktree: "/root/deps/right", sandboxes: [] },
    ]

    expect(projectForDirectory(projects, "/root/deps/right")?.worktree).toBe("/root/deps/right")
  })

  test("skips sandbox roots that are also project worktrees", () => {
    const projects = [
      { worktree: "/root", sandboxes: ["/root/deps/right", "/root/wt"] },
      { worktree: "/root/deps/right", sandboxes: [] },
    ]

    const roots = sandboxRoots(projects)

    expect(roots.get("/root/deps/right")).toBeUndefined()
    expect(roots.get("/root/wt")).toBe("/root")
  })
})
