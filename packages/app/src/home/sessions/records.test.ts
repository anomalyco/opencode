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
  const opened = { id: "project-a", worktree: "/repo/a" } as LocalProject
  const sessions = [session("a", "/repo/a", "project-a"), session("b", "/repo/b", "project-b")]

  test("includes sessions outside added projects when unfiltered", () => {
    const records = buildHomeSessionRecords({
      sessions: () => sessions,
      projectDirectories: () => undefined,
      projects: () => [opened],
    })

    expect(records.map((record) => record.session.id)).toEqual(["a", "b"])
    expect(records[1]?.project).toMatchObject({ id: "project-b", worktree: "/repo/b" })
  })

  test("filters sessions when a project is selected", () => {
    const records = buildHomeSessionRecords({
      sessions: () => sessions,
      projectDirectories: () => ["/repo/a"],
      projects: () => [opened],
    })

    expect(records.map((record) => record.session.id)).toEqual(["a"])
  })

  test("includes sessions in a subfolder of the selected project", () => {
    const records = buildHomeSessionRecords({
      sessions: () => [
        session("root", "/repo/a", "project-a"),
        session("child", "/repo/a/android-app", "project-a"),
        session("sibling", "/repo/ab", "project-ab"),
      ],
      projectDirectories: () => ["/repo/a"],
      projects: () => [opened],
    })

    expect(records.map((record) => record.session.id).toSorted()).toEqual(["child", "root"])
  })

  test("matches Windows subfolders across separators and drive-letter case", () => {
    const records = buildHomeSessionRecords({
      sessions: () => [session("child", "c:/work/personal/android-app", "project-p")],
      projectDirectories: () => ["C:\\work\\personal"],
      projects: () => [{ id: "project-p", worktree: "C:\\work\\personal" }],
    })

    expect(records.map((record) => record.session.id)).toEqual(["child"])
  })

  test("leaves sessions of a separately added nested project to that project", () => {
    const nested: LocalProject = { id: "project-app", worktree: "/repo/a/packages/app" }

    const sessions = [
      session("root", "/repo/a", "project-a"),
      session("nested", "/repo/a/packages/app/src", "project-app"),
    ]

    const parent = buildHomeSessionRecords({
      sessions: () => sessions,
      projectDirectories: () => ["/repo/a"],
      projects: () => [opened, nested],
    })

    const child = buildHomeSessionRecords({
      sessions: () => sessions,
      projectDirectories: () => ["/repo/a/packages/app"],
      projects: () => [opened, nested],
    })

    expect(parent.map((record) => record.session.id)).toEqual(["root"])
    expect(child.map((record) => record.session.id)).toEqual(["nested"])
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
    const nested = { id: "project-a", worktree: "/repo/a/packages/app" } as LocalProject

    const records = buildHomeSessionRecords({
      sessions: () => [session("n", "/repo/a/packages/app", "project-a")],
      projectDirectories: () => undefined,
      projects: () => [opened, nested],
    })

    expect(records[0]?.project.worktree).toBe("/repo/a/packages/app")
  })

  test("orders by update time and uses the id only to break equal timestamps", () => {
    const at = (id: string, updated: number) => ({
      ...session(id, "/repo/a", "project-a"),
      time: { created: 1, updated },
    })

    const records = buildHomeSessionRecords({
      sessions: () => [at("ses_z", 2), at("ses_old", 1), at("ses_a", 2)],
      projectDirectories: () => undefined,
      projects: () => [opened],
    })

    expect(records.map((record) => record.session.id)).toEqual(["ses_a", "ses_z", "ses_old"])
  })
})

test("homeSessionLocation returns the worktree directory name and branch when known", () => {
  expect(homeSessionLocation("/repo/.worktrees/crisp-cactus", "feature/home")).toEqual({
    worktree: "crisp-cactus",
    branch: "feature/home",
  })
  expect(homeSessionLocation("/repo/.worktrees/crisp-cactus")).toEqual({ worktree: "crisp-cactus", branch: undefined })
})
