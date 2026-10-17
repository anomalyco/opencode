import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
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

  test.each([
    { worktree: "main", directory: "/project/feature", createBranch: undefined, expected: "dev" },
    { worktree: "main", directory: "/project", createBranch: undefined, expected: "dev" },
    { worktree: "create", directory: "/project/feature", createBranch: undefined, expected: "feature" },
    { worktree: "/project/feature", directory: "/project", createBranch: undefined, expected: "feature" },
    { worktree: "/missing", directory: "/project/feature", createBranch: undefined, expected: undefined },
    { worktree: "create", directory: "/project/feature", createBranch: "release", expected: "release" },
  ])("resolves the branch for $worktree in $directory (new branch: $createBranch)", (row) => {
    expect(
      resolveNewSessionBranch({
        worktree: row.worktree,
        directory: row.directory,
        projectDirectory: "/project",
        createBranch: row.createBranch,
        worktreeBranch: (worktree) => branches.get(worktree),
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

test("Local branch follows the selected checkout in the browser runtime", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "test",
      "--conditions=browser",
      "--preload",
      "./happydom.ts",
      "./test-browser/fixtures/new-session-workspace.ts",
    ],
    { cwd: fileURLToPath(new URL("../../..", import.meta.url)), stdout: "pipe", stderr: "pipe" },
  )

  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])

  expect(status, stdout + stderr).toBe(0)
}, 30_000)
