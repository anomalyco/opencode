import { describe, expect, test } from "bun:test"
import { ACPSessionManager } from "../../src/acp/session"

describe("ACPSessionManager", () => {
  // Create a mock SDK
  const createMockSdk = (sessionId: string = "test-session-1") =>
    ({
      session: {
        create: async () => ({ data: { id: sessionId } }),
        get: async () => ({ data: { id: sessionId, time: { created: new Date().toISOString() } } }),
      },
    }) as any

  describe("remove", () => {
    test("removes existing session and returns true", async () => {
      const manager = new ACPSessionManager(createMockSdk())

      await manager.create("/test/path", [], undefined)
      expect(manager.size()).toBe(1)

      const result = manager.remove("test-session-1")
      expect(result).toBe(true)
      expect(manager.size()).toBe(0)
    })

    test("returns false for non-existent session", () => {
      const manager = new ACPSessionManager(createMockSdk())

      const result = manager.remove("non-existent")
      expect(result).toBe(false)
    })
  })

  describe("size", () => {
    test("returns correct count of sessions", async () => {
      let counter = 0
      const sdk = {
        session: {
          create: async () => ({ data: { id: `session-${counter++}` } }),
          get: async (params: any) => ({
            data: { id: params.sessionID, time: { created: new Date().toISOString() } },
          }),
        },
      } as any

      const manager = new ACPSessionManager(sdk)
      expect(manager.size()).toBe(0)

      await manager.create("/path1", [], undefined)
      expect(manager.size()).toBe(1)

      await manager.create("/path2", [], undefined)
      expect(manager.size()).toBe(2)
    })
  })

  describe("sessionIds", () => {
    test("returns all session IDs", async () => {
      let counter = 0
      const sdk = {
        session: {
          create: async () => ({ data: { id: `session-${counter++}` } }),
        },
      } as any

      const manager = new ACPSessionManager(sdk)

      await manager.create("/path1", [], undefined)
      await manager.create("/path2", [], undefined)
      await manager.create("/path3", [], undefined)

      const ids = manager.sessionIds()
      expect(ids).toHaveLength(3)
      expect(ids).toContain("session-0")
      expect(ids).toContain("session-1")
      expect(ids).toContain("session-2")
    })
  })

  describe("clear", () => {
    test("removes all sessions", async () => {
      let counter = 0
      const sdk = {
        session: {
          create: async () => ({ data: { id: `session-${counter++}` } }),
        },
      } as any

      const manager = new ACPSessionManager(sdk)

      await manager.create("/path1", [], undefined)
      await manager.create("/path2", [], undefined)
      await manager.create("/path3", [], undefined)

      expect(manager.size()).toBe(3)

      manager.clear()
      expect(manager.size()).toBe(0)
      expect(manager.sessionIds()).toEqual([])
    })
  })
})
