import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { ACPSessionManager } from "../../src/acp/session"

describe("ACPSessionManager", () => {
  // Create a mock SDK
  const mockSdk = {
    session: {
      create: async () => ({ data: { id: "test-session-1" } }),
      get: async () => ({ data: { id: "test-session-1", time: { created: new Date().toISOString() } } }),
    },
  } as any

  describe("remove", () => {
    test("removes existing session and returns true", async () => {
      const manager = new ACPSessionManager(mockSdk)

      // Create a session
      await manager.create("/test/path", [], undefined)
      expect(manager.size()).toBe(1)

      // Remove it
      const result = manager.remove("test-session-1")
      expect(result).toBe(true)
      expect(manager.size()).toBe(0)
    })

    test("returns false for non-existent session", () => {
      const manager = new ACPSessionManager(mockSdk)

      const result = manager.remove("non-existent")
      expect(result).toBe(false)
    })
  })

  describe("size", () => {
    test("returns correct count of sessions", async () => {
      const manager = new ACPSessionManager(mockSdk)
      expect(manager.size()).toBe(0)

      // Create sessions with different IDs
      const sdk1 = {
        session: { create: async () => ({ data: { id: "session-1" } }) },
      } as any
      const sdk2 = {
        session: { create: async () => ({ data: { id: "session-2" } }) },
      } as any

      const manager1 = new ACPSessionManager(sdk1)
      await manager1.create("/path1", [], undefined)
      expect(manager1.size()).toBe(1)

      // Create another in same manager via load
      const loadSdk = {
        session: {
          create: async () => ({ data: { id: "session-a" } }),
          get: async () => ({ data: { id: "session-b", time: { created: new Date().toISOString() } } }),
        },
      } as any
      const manager2 = new ACPSessionManager(loadSdk)
      await manager2.create("/path", [], undefined)
      await manager2.load("session-b", "/path", [], undefined)
      expect(manager2.size()).toBe(2)
    })
  })

  describe("clear", () => {
    test("removes all sessions", async () => {
      const sdk = {
        session: {
          create: async () => ({ data: { id: `session-${Math.random()}` } }),
          get: async (params: any) => ({
            data: { id: params.sessionID, time: { created: new Date().toISOString() } },
          }),
        },
      } as any

      const manager = new ACPSessionManager(sdk)

      await manager.create("/path1", [], undefined)
      await manager.create("/path2", [], undefined)
      await manager.create("/path3", [], undefined)

      expect(manager.size()).toBe(3)

      manager.clear()
      expect(manager.size()).toBe(0)
    })
  })
})
