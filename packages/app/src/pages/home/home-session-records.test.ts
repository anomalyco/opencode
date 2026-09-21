import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import type { LocalProject } from "@/context/layout"
import { buildHomeSessionRecords } from "./home-session-records"

const session = (input: { id: string; directory: string; projectID: string; updated?: number }): Session =>
  ({
    id: input.id,
    slug: input.id,
    projectID: input.projectID,
    directory: input.directory,
    title: input.id,
    version: "",
    time: { created: input.updated ?? 1, updated: input.updated ?? 1 },
  }) as Session

const project = (input: { id?: string; worktree: string }): LocalProject =>
  ({ ...input, expanded: false }) as LocalProject

function build(input: {
  sessions: Session[]
  projects: LocalProject[]
  directories: string[]
}) {
  const byID = new Map(input.projects.flatMap((item) => (item.id ? [[item.id, item] as const] : [])))
  return buildHomeSessionRecords({
    sessions: () => input.sessions,
    projectDirectories: () => input.directories,
    projects: () => input.projects,
    projectByID: () => byID,
  })
}

describe("buildHomeSessionRecords", () => {
  test("keeps a global session whose directory does not match the global worktree", () => {
    const global = project({ id: "global", worktree: "/" })
    const records = build({
      projects: [global],
      directories: ["/"],
      sessions: [session({ id: "s1", directory: "/home/user/project", projectID: "global" })],
    })

    expect(records.map((record) => record.session.id)).toEqual(["s1"])
    expect(records[0]?.project).toBe(global)
    expect(records[0]?.projectName).toBe("/")
  })

  test("still drops sessions that belong to a project outside the current scope", () => {
    const scoped = project({ id: "project-a", worktree: "/work/a" })
    const records = build({
      projects: [scoped],
      directories: ["/work/a"],
      sessions: [
        session({ id: "keep", directory: "/work/a", projectID: "project-a" }),
        session({ id: "drop", directory: "/work/b", projectID: "project-b" }),
      ],
    })

    expect(records.map((record) => record.session.id)).toEqual(["keep"])
  })

  test("matches by directory when the project has no id", () => {
    const unknown = project({ worktree: "/work/c" })
    const records = build({
      projects: [unknown],
      directories: ["/work/c"],
      sessions: [session({ id: "s1", directory: "/work/c", projectID: "project-c" })],
    })

    expect(records.map((record) => record.session.id)).toEqual(["s1"])
    expect(records[0]?.project).toBe(unknown)
  })
})
