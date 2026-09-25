import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import type { LocalProject } from "@/shell/state/layout"
import { buildHomeSessionRecords, homeSessionLocation } from "./records"

const session = (id: string, directory: string, projectID: string) =>
  ({
    id,
    projectID,
    title: id,
    location: { directory },
    time: { created: 1, updated: 1 },
  }) as SessionInfo

describe("buildHomeSessionRecords", () => {
  const opened = { id: "project-a", worktree: "/repo/a", expanded: true } as LocalProject
  const sessions = [session("a", "/repo/a", "project-a"), session("b", "/repo/b", "project-b")]

  test("includes sessions outside added projects when unfiltered", () => {
    const records = buildHomeSessionRecords({
      sessions: () => sessions,
      projectDirectories: () => undefined,
      projects: () => [opened],
    })

    expect(records.map((record) => record.session.id)).toEqual(["a", "b"])
    expect(records[1]?.project).toMatchObject({ id: "project-b", worktree: "/repo/b", expanded: false })
  })

  test("filters sessions when a project is selected", () => {
    const records = buildHomeSessionRecords({
      sessions: () => sessions,
      projectDirectories: () => ["/repo/a"],
      projects: () => [opened],
    })

    expect(records.map((record) => record.session.id)).toEqual(["a"])
  })

  test("labels a worktree session with its project before that project's inventory has loaded", () => {
    const records = buildHomeSessionRecords({
      sessions: () => [session("w", "/repo/a/.worktrees/feature", "project-a")],
      projectDirectories: () => undefined,
      projects: () => [{ ...opened, name: "Project A" }],
    })

    expect(records[0]?.project).toMatchObject({ id: "project-a", worktree: "/repo/a" })
    expect(records[0]?.projectName).toBe("Project A")
  })

  test("prefers the added project whose directory matches over a sibling entry with the same ID", () => {
    const nested = { id: "project-a", worktree: "/repo/a/packages/app", expanded: true } as LocalProject
    const records = buildHomeSessionRecords({
      sessions: () => [session("n", "/repo/a/packages/app", "project-a")],
      projectDirectories: () => undefined,
      projects: () => [opened, nested],
    })

    expect(records[0]?.project.worktree).toBe("/repo/a/packages/app")
  })

  test("uses the same resolved project as session tabs, including stored projects", () => {
    const stored = { id: "project-b", worktree: "/repo/b", expanded: false, icon: { override: "stored-icon" } }
    const records = buildHomeSessionRecords({
      sessions: () => [session("b", "/repo/b", "project-b")],
      projectDirectories: () => undefined,
      projects: () => [],
      resolveProject: () => stored,
    })

    expect(records[0]?.project).toBe(stored)
  })
})

describe("homeSessionLocation", () => {
  test("returns the worktree directory name and branch", () => {
    expect(homeSessionLocation("/repo/.worktrees/crisp-cactus", "feature/home")).toEqual({
      worktree: "crisp-cactus",
      branch: "feature/home",
    })
  })

  test("uses the worktree name while branch metadata is unavailable", () => {
    expect(homeSessionLocation("/repo/.worktrees/crisp-cactus")).toEqual({
      worktree: "crisp-cactus",
      branch: undefined,
    })
  })
})
