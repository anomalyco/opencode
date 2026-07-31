import { describe, expect, test } from "bun:test"
import {
  normalizeNewSessionWorktree,
  resolveNewSessionBranch,
  resolveNewSessionBranchTarget,
  resolveNewSessionWorktree,
} from "./new-session-workspace-controller"

describe("new session workspace selection", () => {
  test("uses main when the workspace bar is unavailable", () => {
    expect(
      resolveNewSessionWorktree({
        enabled: false,
        selected: "/project/feature",
        directory: "/project/feature",
        projectWorktree: "/project",
      }),
    ).toBe("main")
  })

  test("derives an existing worktree from the current directory", () => {
    expect(
      resolveNewSessionWorktree({ enabled: true, directory: "/project/feature", projectWorktree: "/project" }),
    ).toBe("/project/feature")
    expect(resolveNewSessionWorktree({ enabled: true, directory: "/project", projectWorktree: "/project" })).toBe(
      "main",
    )
  })

  test("normalizes main to the project root outside the main worktree", () => {
    expect(normalizeNewSessionWorktree("main", "/project/feature", "/project")).toBe("/project")
    expect(normalizeNewSessionWorktree("main", "/project", "/project")).toBe("main")
  })

  test("falls back to the local branch for main and unknown worktrees", () => {
    const branch = (worktree: string) => (worktree === "/project/feature" ? "feature" : undefined)
    expect(resolveNewSessionBranch({ worktree: "main", local: "feature", worktreeBranch: branch })).toBe("feature")
    expect(resolveNewSessionBranch({ worktree: "/project/feature", local: "dev", worktreeBranch: branch })).toBe(
      "feature",
    )
    expect(resolveNewSessionBranch({ worktree: "/missing", local: "dev", worktreeBranch: branch })).toBe("dev")
  })

  test("prefers the selected base then the default branch when creating a workspace", () => {
    const branch = () => undefined
    expect(
      resolveNewSessionBranch({
        worktree: "create",
        base: "origin/release",
        local: "feature",
        fallback: "dev",
        worktreeBranch: branch,
      }),
    ).toBe("origin/release")
    expect(
      resolveNewSessionBranch({ worktree: "create", local: "feature", fallback: "dev", worktreeBranch: branch }),
    ).toBe("dev")
    expect(resolveNewSessionBranch({ worktree: "create", local: "feature", worktreeBranch: branch })).toBe("feature")
  })

  test("targets a checkout directory only outside create", () => {
    expect(resolveNewSessionBranchTarget({ worktree: "create", projectRoot: "/project" })).toBeUndefined()
    expect(resolveNewSessionBranchTarget({ worktree: "main", projectRoot: "/project" })).toBe("/project")
    expect(resolveNewSessionBranchTarget({ worktree: "/project/feature", projectRoot: "/project" })).toBe(
      "/project/feature",
    )
  })
})
