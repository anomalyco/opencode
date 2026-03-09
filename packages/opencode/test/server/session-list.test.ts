import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { Database, eq } from "../../src/storage/db"
import { SessionTable } from "../../src/session/session.sql"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("Session.list", () => {
  test("filters by directory", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const first = await Session.create({})

        const otherDir = path.join(projectRoot, "..", "__session_list_other")
        const second = await Instance.provide({
          directory: otherDir,
          fn: async () => Session.create({}),
        })

        const sessions = [...Session.list({ directory: projectRoot })]
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(first.id)
        expect(ids).not.toContain(second.id)
      },
    })
  })

  test("filters root sessions", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const root = await Session.create({ title: "root-session" })
        const child = await Session.create({ title: "child-session", parentID: root.id })

        const sessions = [...Session.list({ roots: true })]
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(root.id)
        expect(ids).not.toContain(child.id)
      },
    })
  })

  test("filters by start time", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({ title: "new-session" })
        const futureStart = Date.now() + 86400000

        const sessions = [...Session.list({ start: futureStart })]
        expect(sessions.length).toBe(0)
      },
    })
  })

  test("filters by search term", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        await Session.create({ title: "unique-search-term-abc" })
        await Session.create({ title: "other-session-xyz" })

        const sessions = [...Session.list({ search: "unique-search" })]
        const titles = sessions.map((s) => s.title)

        expect(titles).toContain("unique-search-term-abc")
        expect(titles).not.toContain("other-session-xyz")
      },
    })
  })

  test("respects limit parameter", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        await Session.create({ title: "session-1" })
        await Session.create({ title: "session-2" })
        await Session.create({ title: "session-3" })

        const sessions = [...Session.list({ limit: 2 })]
        expect(sessions.length).toBe(2)
      },
    })
  })

  test("includes sessions with NULL workspace_id when filtering by workspaceID", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // Create a session (will have workspace_id = undefined since no workspace context)
        const session = await Session.create({ title: "pre-migration-session" })

        // Verify the session has no workspace_id
        expect(session.workspaceID).toBeUndefined()

        // When filtering by a workspaceID, sessions with NULL workspace_id
        // should still be included (they are pre-migration sessions)
        const sessions = [...Session.list({ workspaceID: "test-workspace-id" })]
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(session.id)
      },
    })
  })

  test("directory filter prevents cross-worktree session leakage", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // Create a session in the current directory
        const localSession = await Session.create({ title: "local-session" })

        // Create a session in a different directory (simulating a different worktree)
        const otherDir = path.join(projectRoot, "..", "__other_worktree")
        const otherSession = await Instance.provide({
          directory: otherDir,
          fn: async () => Session.create({ title: "other-worktree-session" }),
        })

        // Both sessions share the same project_id (same git root)
        expect(localSession.projectID).toBe(otherSession.projectID)

        // Without directory filter, both sessions appear
        const allSessions = [...Session.list({})]
        const allIds = allSessions.map((s) => s.id)
        expect(allIds).toContain(localSession.id)
        expect(allIds).toContain(otherSession.id)

        // With directory filter, only the local session appears
        const scopedSessions = [...Session.list({ directory: projectRoot })]
        const scopedIds = scopedSessions.map((s) => s.id)
        expect(scopedIds).toContain(localSession.id)
        expect(scopedIds).not.toContain(otherSession.id)
      },
    })
  })

  test("createNext accepts explicit workspaceID", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.createNext({
          directory: projectRoot,
          workspaceID: "explicit-workspace-123",
          title: "session-with-workspace",
        })

        expect(session.workspaceID).toBe("explicit-workspace-123")
      },
    })
  })
})
