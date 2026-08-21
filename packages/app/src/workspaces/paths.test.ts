import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode-ai/client/promise"
import {
  filterWorkspaceInventory,
  inspectWorkspaceDeletion,
  isWorkspaceDirectory,
  isWorkspaceSelection,
  mergeWorkspaceSessionInventory,
  sessionsForWorkspace,
  workspaceInventory,
} from "./paths"

describe("isWorkspaceDirectory", () => {
  const project = {
    worktree: "C:\\repo\\",
    sandboxes: ["C:\\repo-workspaces\\feature\\", "C:\\repo-workspaces\\other"],
  }

  test("distinguishes managed workspaces from the local repository", () => {
    expect(isWorkspaceDirectory(project, "C:\\repo")).toBe(false)
    expect(isWorkspaceDirectory(project, "C:\\repo-workspaces\\feature")).toBe(true)
    expect(isWorkspaceDirectory(project, "c:\\repo-workspaces\\feature\\packages\\app")).toBe(true)
    expect(
      isWorkspaceDirectory({ worktree: "/repo", sandboxes: ["/repo/.worktrees/feature"] }, "/repo/.worktrees/feature"),
    ).toBe(true)
    expect(isWorkspaceDirectory(project, "C:\\other")).toBe(false)
    expect(isWorkspaceDirectory(undefined, "C:\\repo-workspaces\\feature")).toBe(false)
  })
})

describe("isWorkspaceSelection", () => {
  const project = { worktree: "/repo", sandboxes: ["/workspaces/feature"] }

  test("accepts local, new, and managed workspace selections", () => {
    expect(isWorkspaceSelection(project, "main")).toBe(true)
    expect(isWorkspaceSelection(project, "create")).toBe(true)
    expect(isWorkspaceSelection(project, "/repo/")).toBe(true)
    expect(isWorkspaceSelection(project, "/workspaces/feature/")).toBe(true)
    expect(isWorkspaceSelection({ worktree: "C:\\repo" }, "c:\\repo\\")).toBe(true)
    expect(isWorkspaceSelection(project, "/other/workspace")).toBe(false)
  })
})

test("groups and filters workspace inventory by project", () => {
  const inventory = workspaceInventory([
    {
      id: "a",
      worktree: "/a",
      sandboxes: ["/a", "/a/one", "/a/two"],
      worktrees: [
        { directory: "/a" },
        { directory: "/a/one", strategy: "git" },
        { directory: "/a/two", strategy: "git" },
      ],
    },
    {
      id: "b",
      worktree: "/b",
      sandboxes: ["/b/one"],
      worktrees: [{ directory: "/b/one", strategy: "git" }],
    },
  ])

  expect(inventory.map((item) => [item.project.id, item.directory])).toEqual([
    ["a", "/a/one"],
    ["a", "/a/two"],
    ["b", "/b/one"],
  ])
  expect(filterWorkspaceInventory(inventory, "a").map((item) => item.directory)).toEqual(["/a/one", "/a/two"])
  expect(filterWorkspaceInventory(inventory, "all")).toEqual(inventory)
})

test("reports every workspace deletion condition", () => {
  const session = (directory: string) => ({ location: { directory }, time: { created: 1, updated: 1 } }) as SessionInfo
  expect(
    inspectWorkspaceDeletion({
      workspace: "/workspace",
      activeDirectory: "/workspace/app",
      sessions: [],
      status: "dirty",
    }),
  ).toEqual({ active: true, linked: false, dirty: true })
  expect(
    inspectWorkspaceDeletion({
      workspace: "/workspace",
      sessions: [session("/workspace/packages/app")],
      status: "dirty",
    }),
  ).toEqual({ active: false, linked: true, dirty: true })
  expect(inspectWorkspaceDeletion({ workspace: "/workspace", sessions: [], status: "dirty" })).toEqual({
    active: false,
    linked: false,
    dirty: true,
  })
  expect(inspectWorkspaceDeletion({ workspace: "/workspace", sessions: [], status: "clean" })).toEqual({
    active: false,
    linked: false,
    dirty: false,
  })
  expect(
    inspectWorkspaceDeletion({
      workspace: "/workspace",
      sessions: [
        { location: { directory: "/workspace" }, time: { created: 1, updated: 1, archived: 2 } } as SessionInfo,
      ],
      status: "clean",
    }),
  ).toEqual({ active: false, linked: false, dirty: false })
})

test("groups nested non-archived workspace sessions by latest activity", () => {
  const session = (id: string, directory: string, updated: number, archived?: number) =>
    ({ id, location: { directory }, time: { created: 1, updated, archived } }) as SessionInfo
  const sessions = sessionsForWorkspace(
    [
      session("old", "/workspace", 2),
      session("nested", "/workspace/packages/app", 3),
      session("archived", "/workspace", 4, 5),
      session("other", "/other", 6),
    ],
    "/workspace",
  )
  expect(sessions.map((item) => item.id)).toEqual(["nested", "old"])
})

test("merges workspace placement by freshness with authoritative server ties", () => {
  const session = (directory: string, updated: number) =>
    ({ id: "session", location: { directory }, time: { created: 1, updated } }) as SessionInfo

  expect(
    mergeWorkspaceSessionInventory([session("/destination", 3)], [session("/source", 2)])[0]?.location.directory,
  ).toBe("/destination")
  expect(
    mergeWorkspaceSessionInventory([session("/destination", 3)], [session("/source", 3)])[0]?.location.directory,
  ).toBe("/destination")
  expect(
    mergeWorkspaceSessionInventory([session("/destination", 2)], [session("/source", 3)])[0]?.location.directory,
  ).toBe("/source")
})
