import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode-ai/client/promise"
import type { LocalProject } from "@/context/layout"
import { buildHomeSessionRecords } from "./home-sessions-model"

const session = (id: string, directory: string, projectID = "project") =>
  ({
    id,
    projectID,
    title: id,
    time: { created: 1, updated: 1 },
    location: { directory },
  }) as SessionInfo

const project = (worktree: string, input: Partial<LocalProject> = {}) =>
  ({ worktree, expanded: false, ...input }) as LocalProject

describe("Home session records", () => {
  test("includes sessions from projects that were not added", () => {
    const result = buildHomeSessionRecords({
      sessions: () => [session("unadded", "/repo/worktree")],
      projectDirectories: () => undefined,
      projects: () => [],
      projectByID: () => new Map(),
      projectMetadataByID: () => new Map([["project", project("/repo", { name: "Project name" })]]),
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.project.worktree).toBe("/repo/worktree")
    expect(result[0]?.projectName).toBe("Project name")
  })

  test("keeps selected project scoping", () => {
    const result = buildHomeSessionRecords({
      sessions: () => [session("selected", "/selected"), session("other", "/other", "other")],
      projectDirectories: () => ["/selected"],
      projects: () => [project("/selected")],
      projectByID: () => new Map(),
      projectMetadataByID: () => new Map(),
    })

    expect(result.map((item) => item.session.id)).toEqual(["selected"])
  })
})
