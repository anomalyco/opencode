import { expect, test } from "bun:test"
import { ProjectID } from "@opencode/schema/project-id"
import { projectSessionDirectories } from "./queries"

test("Home excludes another added project from a shared global worktree inventory", () => {
  const work = {
    id: ProjectID.global,
    worktree: "C:/work/work",
    sandboxes: ["C:/work/personal", "C:/scratch/worktree"],
  }

  const personal = { id: ProjectID.make("personal"), worktree: "c:\\work\\personal" }

  expect(projectSessionDirectories(work, [work, personal])).toEqual(["C:/work/work", "C:/scratch/worktree"])
})

test("Home excludes an added parent root from a nested global project's workspaces", () => {
  const work = {
    id: ProjectID.global,
    worktree: "C:/work/nested",
    sandboxes: ["C:/work", "C:/work/nested/android-app", "C:/scratch/worktree"],
  }

  const projects = [work, { id: ProjectID.make("parent"), worktree: "c:\\WORK\\" }]

  expect(projectSessionDirectories(work, [work])).toEqual([
    "C:/work/nested",
    "C:/work",
    "C:/work/nested/android-app",
    "C:/scratch/worktree",
  ])
  expect(projectSessionDirectories(work, projects)).toEqual([
    "C:/work/nested",
    "C:/work/nested/android-app",
    "C:/scratch/worktree",
  ])
})
