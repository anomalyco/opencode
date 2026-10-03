import { describe, expect, test } from "bun:test"
import {
  cycleNewSessionWorktree,
  resolveNewSessionBranch,
  resolveNewSessionGit,
  resolveNewSessionWorktree,
} from "./controller"

describe("new session workspace selection", () => {
  test.each([
    {
      name: "main when the workspace bar is unavailable",
      input: { enabled: false, selected: "/project/feature" },
      expected: "main",
    },
    {
      name: "the saved new-workspace destination",
      input: { enabled: true, fallback: "create" as const },
      expected: "create",
    },
    { name: "the saved local destination", input: { enabled: true, fallback: "main" as const }, expected: "main" },
    {
      name: "local when the cached project path is stale",
      input: { enabled: true, directory: "C:/Projects/repo", projectWorktree: "D:/Projects/repo" },
      expected: "main",
    },
    {
      name: "the selection when the cached project path is stale",
      input: {
        enabled: true,
        directory: "C:/Projects/repo",
        projectWorktree: "D:/Projects/repo",
        selected: "/worktree",
      },
      expected: "/worktree",
    },
  ])("resolves $name", ({ input, expected }) => {
    expect(resolveNewSessionWorktree(input)).toBe(expected)
  })

  test("keeps the worktree used to open a draft ahead of the saved destination", () => {
    const input = {
      enabled: true,
      directory: "C:\\repos\\app-wt1",
      projectWorktree: "C:\\repos\\app",
      workspaces: ["C:\\repos\\app-wt1"],
    }
    expect(resolveNewSessionWorktree({ ...input, fallback: "main" })).toBe(input.directory)
    expect(resolveNewSessionWorktree({ ...input, fallback: "create" })).toBe(input.directory)
    expect(resolveNewSessionWorktree({ ...input, selected: "main" })).toBe("main")
    expect(resolveNewSessionWorktree({ ...input, directory: input.projectWorktree, fallback: "create" })).toBe(
      "create",
    )
    expect(resolveNewSessionWorktree({ ...input, workspaces: [], fallback: "main" })).toBe("main")
  })

  const branch = (worktree: string) => (worktree === "/project/feature" ? "feature" : undefined)

  test.each([
    { worktree: "main", directory: "/project/feature", createBranch: undefined, expected: "feature" },
    { worktree: "create", directory: "/project/feature", createBranch: undefined, expected: "feature" },
    { worktree: "/project/feature", directory: "/project", createBranch: undefined, expected: "feature" },
    { worktree: "/missing", directory: "/project/feature", createBranch: undefined, expected: undefined },
    { worktree: "create", directory: "/project/feature", createBranch: "release", expected: "release" },
  ])("resolves the branch for $worktree in $directory (new branch: $createBranch)", (row) => {
    expect(
      resolveNewSessionBranch({
        worktree: row.worktree,
        directory: row.directory,
        createBranch: row.createBranch,
        worktreeBranch: branch,
      }),
    ).toBe(row.expected)
  })

  test("uses location VCS state when the project inventory is stale", () => {
    expect(resolveNewSessionGit({ branch: "dev" })).toBe(true)
    expect(resolveNewSessionGit({ projectVcs: "git" })).toBe(true)
    expect(resolveNewSessionGit({})).toBe(false)
  })

  const existing = "/project/feature"

  test.each([
    { current: "main", existing: undefined, expected: "create" },
    { current: "create", existing: undefined, expected: "main" },
    { current: existing, existing, expected: "main" },
    { current: "main", existing, expected: "create" },
    { current: "create", existing, expected: existing },
  ])("cycles from $current (existing: $existing) to $expected", ({ current, existing, expected }) => {
    expect(cycleNewSessionWorktree({ current, existing })).toBe(expected)
  })
})
