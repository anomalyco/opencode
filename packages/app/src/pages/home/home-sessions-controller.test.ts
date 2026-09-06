import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import type { LocalProject } from "@/context/layout"
import { visibleProjectEntries } from "@/context/server"
import { buildHomeSessionRecords } from "./home-session-records"

describe("buildHomeSessionRecords", () => {
  test("shows sessions for projects discovered from the server", () => {
    const projects = visibleProjectEntries([], [{ worktree: "/repo/b" }], []) as LocalProject[]
    const sessions = [
      {
        id: "ses_server_project",
        directory: "/repo/b",
        time: { created: 1, updated: 2 },
      } as Session,
    ]

    const records = buildHomeSessionRecords({
      sessions: () => sessions,
      projectDirectories: () => projects.map((project) => project.worktree),
      projects: () => projects,
      projectByID: () => new Map(),
    })

    expect(records).toHaveLength(1)
    expect(records[0]?.session.id).toBe("ses_server_project")
    expect(records[0]?.project.worktree).toBe("/repo/b")
  })
})
