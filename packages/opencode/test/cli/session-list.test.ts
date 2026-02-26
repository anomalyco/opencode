import { describe, expect, test } from "bun:test"
import { formatSessionJSON, formatSessionTable } from "../../src/cli/cmd/session"
import type { Session } from "../../src/session"

function buildSession(input: { id: string; projectID: string; title: string; updated: number }): Session.Info {
  return {
    id: input.id,
    slug: "test-slug",
    projectID: input.projectID,
    directory: "/tmp/project",
    title: input.title,
    version: "1.0.0",
    time: {
      created: input.updated,
      updated: input.updated,
    },
  }
}

describe("session list formatting", () => {
  test("shows Project ID column for all sessions table", () => {
    const sessions = [
      buildSession({
        id: "ses_1",
        projectID: "proj_1",
        title: "Session One",
        updated: 1710000000000,
      }),
    ]

    const output = formatSessionTable(sessions, true)
    const lines = output.split("\n")

    expect(lines[0]).toContain("Project ID")
    expect(lines[2]).toContain("proj_1")
  })

  test("hides Project ID column for default table", () => {
    const sessions = [
      buildSession({
        id: "ses_1",
        projectID: "proj_1",
        title: "Session One",
        updated: 1710000000000,
      }),
    ]

    const output = formatSessionTable(sessions)
    const lines = output.split("\n")

    expect(lines[0]).not.toContain("Project ID")
    expect(lines[2]).not.toContain("proj_1")
  })

  test("json output includes project id", () => {
    const sessions = [
      buildSession({
        id: "ses_1",
        projectID: "proj_1",
        title: "Session One",
        updated: 1710000000000,
      }),
    ]

    const output = formatSessionJSON(sessions)
    const parsed = JSON.parse(output) as { projectId: string }[]

    expect(parsed[0].projectId).toBe("proj_1")
  })
})
