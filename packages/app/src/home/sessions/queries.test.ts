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
