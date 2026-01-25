import { describe, expect, test, beforeAll } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"

Log.init({ print: false })

describe("Session-Workspace Association", () => {
  describe("Session.createNext with workspaceID", async () => {
    const { Session } = await import("../../src/session")

    test("creates session without workspaceID (backwards compatible)", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.createNext({
            directory: tmp.path,
          })

          expect(session.id).toBeTruthy()
          expect(session.workspaceID).toBeUndefined()

          await Session.remove(session.id)
        },
      })
    })

    test("creates session with workspaceID", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const workspaceID = "workspace_test123"
          const session = await Session.createNext({
            directory: tmp.path,
            workspaceID,
          })

          expect(session.id).toBeTruthy()
          expect(session.workspaceID).toBe(workspaceID)

          await Session.remove(session.id)
        },
      })
    })

    test("persists workspaceID when retrieving session", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const workspaceID = "workspace_persist123"
          const created = await Session.createNext({
            directory: tmp.path,
            workspaceID,
          })

          const retrieved = await Session.get(created.id)
          expect(retrieved.workspaceID).toBe(workspaceID)

          await Session.remove(created.id)
        },
      })
    })
  })

  describe("Session.listByWorkspace", async () => {
    const { Session } = await import("../../src/session")
    const { Identifier } = await import("../../src/id/id")

    test("returns empty array when no sessions for workspace", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sessions = await Session.listByWorkspace(Identifier.ascending("workspace"))
          expect(sessions).toEqual([])
        },
      })
    })

    test("returns only sessions for specific workspace", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const workspaceA = Identifier.ascending("workspace")
          const workspaceB = Identifier.ascending("workspace")

          // Create sessions for workspace A
          const sessionA1 = await Session.createNext({
            directory: tmp.path,
            workspaceID: workspaceA,
          })
          const sessionA2 = await Session.createNext({
            directory: tmp.path,
            workspaceID: workspaceA,
          })

          // Create session for workspace B
          const sessionB = await Session.createNext({
            directory: tmp.path,
            workspaceID: workspaceB,
          })

          // Create session without workspace
          const sessionNoWorkspace = await Session.createNext({
            directory: tmp.path,
          })

          const sessionsA = await Session.listByWorkspace(workspaceA)
          expect(sessionsA.length).toBe(2)
          expect(sessionsA.some((s) => s.id === sessionA1.id)).toBe(true)
          expect(sessionsA.some((s) => s.id === sessionA2.id)).toBe(true)

          const sessionsB = await Session.listByWorkspace(workspaceB)
          expect(sessionsB.length).toBe(1)
          expect(sessionsB[0].id).toBe(sessionB.id)

          // Clean up
          await Session.remove(sessionA1.id)
          await Session.remove(sessionA2.id)
          await Session.remove(sessionB.id)
          await Session.remove(sessionNoWorkspace.id)
        },
      })
    })
  })

  describe("Workspace cascade deletion", async () => {
    const { Workspace } = await import("../../src/workspace")
    const { Session } = await import("../../src/session")

    test("removes associated sessions when workspace is deleted", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Create workspace
          const workspace = await Workspace.create({
            name: "cascade-test",
            repoRoot: tmp.path,
          })

          // Create sessions associated with workspace
          const session1 = await Session.createNext({
            directory: workspace.worktreePath,
            workspaceID: workspace.id,
          })
          const session2 = await Session.createNext({
            directory: workspace.worktreePath,
            workspaceID: workspace.id,
          })

          // Create a session NOT associated with the workspace
          const otherSession = await Session.createNext({
            directory: tmp.path,
          })

          // Remove workspace
          await Workspace.remove(workspace.id)

          // Verify associated sessions are deleted
          const sessionsForWorkspace = await Session.listByWorkspace(workspace.id)
          expect(sessionsForWorkspace.length).toBe(0)

          // Verify other session still exists
          const otherSessionExists = await Session.get(otherSession.id)
          expect(otherSessionExists).toBeTruthy()

          // Clean up
          await Session.remove(otherSession.id)
        },
      })
    })
  })
})
