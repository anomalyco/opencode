import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { buildHomeSessionRecords } from "./home-session-records"

const session = (id: string, directory: string, projectID = "project") =>
  ({
    id,
    projectID,
    directory,
    title: id,
    time: { created: 1, updated: 2 },
  }) as Session

describe("buildHomeSessionRecords", () => {
  test("keeps sessions when no projects have been opened locally", () => {
    const records = buildHomeSessionRecords({
      sessions: () => [session("ses_1", "/workspace/demo")],
      projectDirectories: () => [],
      projects: () => [],
      projectByID: () => new Map(),
    })

    expect(records).toHaveLength(1)
    expect(records[0]?.session.id).toBe("ses_1")
    expect(records[0]?.project.worktree).toBe("/workspace/demo")
    expect(records[0]?.projectName).toBe("demo")
  })

  test("filters sessions when project directories are selected", () => {
    const records = buildHomeSessionRecords({
      sessions: () => [session("ses_1", "/workspace/one"), session("ses_2", "/workspace/two")],
      projectDirectories: () => ["/workspace/two"],
      projects: () => [{ id: "two", worktree: "/workspace/two", expanded: true }],
      projectByID: () => new Map([["two", { id: "two", worktree: "/workspace/two", expanded: true }]]),
    })

    expect(records.map((record) => record.session.id)).toEqual(["ses_2"])
  })
})
