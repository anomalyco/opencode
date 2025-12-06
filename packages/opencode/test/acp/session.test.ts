import { describe, expect, test, mock } from "bun:test"
import path from "path"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Storage } from "../../src/storage/storage"
import { ACPSessionManager } from "../../src/acp/session"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

function createMockSDK() {
  return {
    session: {
      create: mock(() =>
        Promise.resolve({
          data: { id: "session_test123" },
        })
      ),
    },
  } as any
}

describe("ACPSessionManager persistence", () => {
  test("should persist session to Storage on create", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sdk = createMockSDK()
        const manager = new ACPSessionManager(sdk)

        const session = await manager.create("/test/cwd", [], {
          providerID: "test",
          modelID: "test-model",
        })

        // Verify session is stored in Storage
        const stored = await Storage.read<any>(["acp_session", session.id]).catch(() => null)
        expect(stored).not.toBeNull()
        expect(stored?.id).toBe(session.id)
        expect(stored?.cwd).toBe("/test/cwd")
      },
    })
  })

  test("should load session from Storage if it exists", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sdk = createMockSDK()

        // Pre-populate storage with a session
        const existingSession = {
          id: "session_existing",
          cwd: "/existing/cwd",
          mcpServers: [],
          createdAt: new Date().toISOString(),
          model: { providerID: "test", modelID: "model" },
        }
        await Storage.write(["acp_session", existingSession.id], existingSession)

        const manager = new ACPSessionManager(sdk)

        // Load the existing session
        const loaded = await manager.load("session_existing")

        expect(loaded).not.toBeNull()
        expect(loaded?.id).toBe("session_existing")
        expect(loaded?.cwd).toBe("/existing/cwd")

        // Clean up
        await Storage.remove(["acp_session", existingSession.id])
      },
    })
  })

  test("should return null when loading non-existent session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sdk = createMockSDK()
        const manager = new ACPSessionManager(sdk)

        const loaded = await manager.load("session_nonexistent")

        expect(loaded).toBeNull()
      },
    })
  })

  test("should update persisted session when model changes", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sdk = createMockSDK()
        const manager = new ACPSessionManager(sdk)

        const session = await manager.create("/test/cwd", [])
        manager.setModel(session.id, { providerID: "new", modelID: "new-model" })

        // Verify Storage was updated
        const stored = await Storage.read<any>(["acp_session", session.id])
        expect(stored?.model?.providerID).toBe("new")
        expect(stored?.model?.modelID).toBe("new-model")

        // Clean up
        await Storage.remove(["acp_session", session.id])
      },
    })
  })
})


