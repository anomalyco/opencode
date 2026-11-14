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

  const branches = new Map([
    ["/project", "dev"],
    ["/project/feature", "feature"],
  ])

  const branch = (worktree: string) => branches.get(worktree)

  test.each([
    { worktree: "main", root: "/project", createBranch: undefined, expected: "dev" },
    { worktree: "create", root: "/project", createBranch: undefined, expected: "dev" },
    { worktree: "/project/feature", root: "/project", createBranch: undefined, expected: "feature" },
    { worktree: "/missing", root: "/project", createBranch: undefined, expected: undefined },
    { worktree: "create", root: "/project", createBranch: "release", expected: "release" },
  ])("resolves the branch for $worktree from $root (new branch: $createBranch)", (row) => {
    expect(
      resolveNewSessionBranch({
        worktree: row.worktree,
        root: row.root,
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
