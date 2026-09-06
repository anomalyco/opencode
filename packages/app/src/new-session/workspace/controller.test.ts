import { describe, expect, test } from "bun:test"
import { resolveNewSessionBranch, resolveNewSessionGit, resolveNewSessionWorktree } from "./controller"

describe("new session workspace selection", () => {
  test("uses main when the workspace bar is unavailable", () => {
    expect(
      resolveNewSessionWorktree({
        enabled: false,
        selected: "/project/feature",
        fallback: "create",
      }),
    ).toBe("main")
  })

  test("uses the saved destination instead of the current worktree", () => {
    expect(
      resolveNewSessionWorktree({
        enabled: true,
        fallback: "create",
      }),
    ).toBe("create")
    expect(
      resolveNewSessionWorktree({
        enabled: true,
        fallback: "main",
      }),
    ).toBe("main")
  })

  test("keeps local selection when the cached project path is stale", () => {
    const input = { enabled: true, directory: "C:/Projects/repo", projectWorktree: "D:/Projects/repo" }
    expect(resolveNewSessionWorktree(input)).toBe("main")
    expect(resolveNewSessionWorktree({ ...input, selected: "/worktree" })).toBe("/worktree")
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

  test("requires Git project metadata before enabling worktree creation", () => {
    expect(resolveNewSessionGit({ projectVcs: "git" })).toBe(true)
    expect(resolveNewSessionGit({ projectVcs: "hg" })).toBe(false)
    expect(resolveNewSessionGit({ projectVcs: "custom" })).toBe(false)
    expect(resolveNewSessionGit({})).toBe(false)
  })
})
