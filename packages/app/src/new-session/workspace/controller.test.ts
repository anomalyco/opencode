import { describe, expect, test } from "bun:test"
import {
  normalizeNewSessionWorktree,
  resolveNewSessionBranch,
  resolveNewSessionGit,
  resolveNewSessionWorktree,
} from "./controller"

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

  test("uses the saved destination instead of the current worktree", () => {
    expect(
      resolveNewSessionWorktree({
        enabled: true,
        directory: "/project/feature",
        projectWorktree: "/project",
        fallback: "create",
      }),
    ).toBe("create")
    expect(
      resolveNewSessionWorktree({
        enabled: true,
        directory: "/project/feature",
        projectWorktree: "/project",
        fallback: "main",
      }),
    ).toBe("/project")
  })

  test("normalizes main to the project root outside the main worktree", () => {
    expect(normalizeNewSessionWorktree("main", "/project/feature", "/project")).toBe("/project")
    expect(normalizeNewSessionWorktree("main", "/project", "/project")).toBe("main")
  })

  test("treats equivalent Windows roots as the main worktree", () => {
    expect(
      resolveNewSessionWorktree({ enabled: true, directory: "C:\\Repo\\", projectWorktree: "c:/repo" }),
    ).toBe("main")
    expect(normalizeNewSessionWorktree("main", "C:\\Repo\\", "c:/repo")).toBe("main")
  })

  test("resolves the branch from the active location", () => {
    const branch = (worktree: string) => (worktree === "/project/feature" ? "feature" : undefined)
    expect(resolveNewSessionBranch({ worktree: "main", directory: "/project/feature", worktreeBranch: branch })).toBe(
      "feature",
    )
    expect(resolveNewSessionBranch({ worktree: "create", directory: "/project/feature", worktreeBranch: branch })).toBe(
      "feature",
    )
    expect(
      resolveNewSessionBranch({ worktree: "/project/feature", directory: "/project", worktreeBranch: branch }),
    ).toBe("feature")
    expect(
      resolveNewSessionBranch({ worktree: "/missing", directory: "/project/feature", worktreeBranch: branch }),
    ).toBe(undefined)
  })

  test("uses a selected branch for a new workspace", () => {
    expect(
      resolveNewSessionBranch({
        worktree: "create",
        directory: "/project/feature",
        createBranch: "release",
        worktreeBranch: () => "feature",
      }),
    ).toBe("release")
  })

  test("uses location VCS state when the project inventory is stale", () => {
    expect(resolveNewSessionGit({ branch: "dev" })).toBe(true)
    expect(resolveNewSessionGit({ projectVcs: "git" })).toBe(true)
    expect(resolveNewSessionGit({})).toBe(false)
  })
})
