import { describe, expect, test } from "bun:test"
import type { Project } from "@opencode-ai/sdk/v2/client"
import { upsertProject } from "./bootstrap"

describe("upsertProject", () => {
  test("inserts missing projects in id order", () => {
    const projects = [{ id: "a" }, { id: "c" }] as Project[]
    const next = upsertProject(projects, { id: "b", worktree: "/repo", vcs: "git" } as Project)

    expect(next.map((item) => item.id)).toEqual(["a", "b", "c"])
    expect(next.find((item) => item.id === "b")?.vcs).toBe("git")
  })

  test("replaces existing projects with current discovery data", () => {
    const projects = [{ id: "repo", worktree: "/old" }] as Project[]
    const next = upsertProject(projects, { id: "repo", worktree: "/repo", vcs: "git" } as Project)

    expect(next).toHaveLength(1)
    expect(next[0]?.worktree).toBe("/repo")
    expect(next[0]?.vcs).toBe("git")
  })
})
