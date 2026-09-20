import { describe, expect, test } from "bun:test"
import { deriveRecentDirectories } from "../../src/component/dialog-move-session"

describe("move recent directories", () => {
  test("sorts by recency and deduplicates directories", () => {
    const sessions = [
      { projectID: "project-a", directory: "C:/repo/backend", time: { updated: 100 } },
      { projectID: "project-a", directory: "C:/repo/agent-runtime", time: { updated: 200 } },
      { projectID: "project-a", directory: "C:/repo/backend", time: { updated: 300 } },
      { projectID: "project-a", directory: "C:/repo/docs", time: { updated: 150 } },
    ]

    expect(
      deriveRecentDirectories(sessions, "project-a", ["C:/repo"], [
        "C:/repo",
        "C:/repo/backend",
        "C:/repo/agent-runtime",
        "C:/repo/docs",
      ]),
    ).toEqual(["C:/repo/backend", "C:/repo/agent-runtime", "C:/repo/docs"])
  })

  test("excludes current, archived, other-project, and invalid destinations", () => {
    const sessions = [
      { projectID: "project-a", directory: "C:/repo/current", time: { updated: 500 } },
      { projectID: "project-a", directory: "C:/repo/archived", time: { updated: 400, archived: 450 } },
      { projectID: "project-b", directory: "C:/repo/other-project", time: { updated: 300 } },
      { projectID: "project-a", directory: "C:/repo/not-a-candidate", time: { updated: 200 } },
      { projectID: "project-a", directory: "C:/repo/backend", time: { updated: 100 } },
    ]

    expect(
      deriveRecentDirectories(
        sessions,
        "project-a",
        ["C:/repo/current"],
        ["C:/repo/current", "C:/repo/backend", "C:/repo/archived"],
      ),
    ).toEqual(["C:/repo/backend"])
  })

  test("keeps the recent group bounded", () => {
    const sessions = Array.from({ length: 7 }, (_, index) => ({
      projectID: "project-a",
      directory: `C:/repo/dir-${index}`,
      time: { updated: 100 - index },
    }))
    const candidates = sessions.map((session) => session.directory)

    expect(deriveRecentDirectories(sessions, "project-a", [], candidates)).toEqual(candidates.slice(0, 5))
  })
})
