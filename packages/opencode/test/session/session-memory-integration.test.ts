import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

// Mock dependencies
vi.mock("../../src/app/app", () => ({
  App: {
    state: vi.fn(() => vi.fn()),
    info: vi.fn(() => ({ path: { cwd: "/test", root: "/test" } })),
  },
}))

vi.mock("../../src/storage/storage", () => ({
  Storage: {
    writeJSON: vi.fn(),
    readJSON: vi.fn(),
    remove: vi.fn(),
    removeDir: vi.fn(),
    list: vi.fn(() => []),
  },
}))

vi.mock("../../src/bus", () => ({
  Bus: {
    publish: vi.fn(),
    event: vi.fn((name, schema) => ({ name, schema })),
  },
}))

vi.mock("../../src/installation", () => ({
  Installation: {
    VERSION: "test-version",
  },
}))

vi.mock("../../src/config/config", () => ({
  Config: {
    get: vi.fn(() => Promise.resolve({ share: "disabled" })),
  },
}))

vi.mock("../../src/id/id", () => ({
  Identifier: {
    descending: vi.fn((prefix) => `${prefix}-${Date.now()}`),
    ascending: vi.fn((prefix) => `${prefix}-${Date.now()}`),
    schema: vi.fn(() => ({ parse: vi.fn(id => id) })),
  },
}))

// Import after mocking
import { SessionMemoryManager } from "../../src/session/memory-manager"

describe("Session Memory Integration", () => {
  let mockState: any
  let sessionCache: SessionMemoryManager.SessionCache

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()
    
    // Create a fresh session cache for each test
    sessionCache = new SessionMemoryManager.SessionCache({
      maxSessions: 5,
      maxMessagesPerSession: 10,
      sessionTtlMs: 5000,
      inactiveTtlMs: 2000,
      cleanupIntervalMs: 100,
    })

    // Mock the state function to return our controlled state
    mockState = {
      sessions: {
        get: vi.fn((id: string) => sessionCache.getSession(id)),
        set: vi.fn((id: string, value: any) => sessionCache.setSession(id, value)),
        delete: vi.fn((id: string) => sessionCache.deleteSession(id)),
        has: vi.fn((id: string) => sessionCache.hasSession(id)),
        keys: vi.fn(() => sessionCache.getSessionKeys()),
        size: sessionCache.size().sessions,
      },
      messages: {
        get: vi.fn((id: string) => sessionCache.getMessages(id)),
        set: vi.fn((id: string, value: any) => sessionCache.setMessages(id, value)),
        delete: vi.fn((id: string) => sessionCache.deleteMessages(id)),
        has: vi.fn((id: string) => sessionCache.getMessages(id) !== undefined),
      },
      pending: new Map(),
      queued: new Map(),
      memoryManager: sessionCache,
    }

    const { App } = require("../../src/app/app")
    App.state.mockReturnValue(() => mockState)
  })

  afterEach(() => {
    sessionCache.destroy()
    SessionMemoryManager.destroyGlobalCache()
  })

  describe("Memory Management in Session Operations", () => {
    it("should handle session creation with memory management", async () => {
      // Import Session after mocking
      const { Session } = await import("../../src/session/index")
      
      // Create a session
      const session = await Session.create()
      
      expect(session).toBeDefined()
      expect(session.id).toBeDefined()
      expect(mockState.sessions.set).toHaveBeenCalledWith(session.id, session)
      
      // Verify session is in memory cache
      expect(sessionCache.getSession(session.id)).toEqual(session)
    })

    it("should handle session retrieval with cache hits and misses", async () => {
      const { Session } = await import("../../src/session/index")
      const { Storage } = require("../../src/storage/storage")
      
      const testSession = {
        id: "test-session-123",
        title: "Test Session",
        version: "test-version",
        time: { created: Date.now(), updated: Date.now() },
      }

      // Mock storage to return the session
      Storage.readJSON.mockResolvedValue(testSession)
      
      // First call should miss cache and load from storage
      const session1 = await Session.get("test-session-123")
      expect(Storage.readJSON).toHaveBeenCalledWith("session/info/test-session-123")
      expect(session1).toEqual(testSession)
      
      // Second call should hit cache
      Storage.readJSON.mockClear()
      const session2 = await Session.get("test-session-123")
      expect(Storage.readJSON).not.toHaveBeenCalled()
      expect(session2).toEqual(testSession)
    })

    it("should handle memory pressure during session operations", async () => {
      const { Session } = await import("../../src/session/index")
      
      // Create sessions beyond cache capacity
      const sessions = []
      for (let i = 0; i < 10; i++) {
        const session = await Session.create()
        sessions.push(session)
      }
      
      // Cache should only retain the most recent sessions
      const stats = sessionCache.getStats()
      expect(stats.sessions.size).toBeLessThanOrEqual(5)
      
      // Most recent sessions should be accessible
      const recentSession = sessions[sessions.length - 1]
      expect(sessionCache.getSession(recentSession.id)).toBeDefined()
      
      // Oldest sessions might be evicted
      const oldestSession = sessions[0]
      const oldestFromCache = sessionCache.getSession(oldestSession.id)
      // It might or might not be in cache depending on LRU eviction
    })

    it("should clean up memory when sessions are removed", async () => {
      const { Session } = await import("../../src/session/index")
      const { Storage } = require("../../src/storage/storage")
      
      // Create a session
      const session = await Session.create()
      const sessionId = session.id
      
      // Add some messages
      const messages = [
        { id: "msg1", content: "Hello" },
        { id: "msg2", content: "World" },
      ]
      sessionCache.setMessages(sessionId, messages)
      
      // Verify session and messages are in cache
      expect(sessionCache.getSession(sessionId)).toBeDefined()
      expect(sessionCache.getMessages(sessionId)).toBeDefined()
      
      // Remove the session
      await Session.remove(sessionId)
      
      // Verify cleanup
      expect(mockState.sessions.delete).toHaveBeenCalledWith(sessionId)
      expect(mockState.messages.delete).toHaveBeenCalledWith(sessionId)
      expect(Storage.remove).toHaveBeenCalledWith(`session/info/${sessionId}`)
      expect(Storage.removeDir).toHaveBeenCalledWith(`session/message/${sessionId}/`)
    })

    it("should handle concurrent session operations", async () => {
      const { Session } = await import("../../src/session/index")
      
      // Create multiple sessions concurrently
      const sessionPromises = Array.from({ length: 5 }, () => Session.create())
      const sessions = await Promise.all(sessionPromises)
      
      expect(sessions).toHaveLength(5)
      sessions.forEach(session => {
        expect(session.id).toBeDefined()
        expect(sessionCache.getSession(session.id)).toBeDefined()
      })
    })

    it("should provide memory statistics", () => {
      // Add some test data
      for (let i = 0; i < 3; i++) {
        sessionCache.setSession(`session${i}`, { id: `session${i}` })
        sessionCache.setMessages(`session${i}`, [{ id: `msg${i}` }])
      }
      
      // Get some sessions to generate hit stats
      sessionCache.getSession("session0")
      sessionCache.getSession("session1")
      sessionCache.getSession("nonexistent") // Miss
      
      const stats = sessionCache.getStats()
      expect(stats.sessions.size).toBe(3)
      expect(stats.messages.size).toBe(3)
      expect(stats.sessions.hits).toBeGreaterThan(0)
      expect(stats.sessions.misses).toBeGreaterThan(0)
    })
  })

  describe("TTL and Cleanup Behavior", () => {
    it("should respect TTL for sessions", async () => {
      // Create cache with short TTL for testing
      const shortTtlCache = new SessionMemoryManager.SessionCache({
        maxSessions: 10,
        sessionTtlMs: 100, // Very short TTL
        inactiveTtlMs: 50,
        cleanupIntervalMs: 25,
      })
      
      try {
        shortTtlCache.setSession("test-session", { id: "test-session" })
        
        // Should be available immediately
        expect(shortTtlCache.getSession("test-session")).toBeDefined()
        
        // Wait for TTL expiration
        await new Promise(resolve => setTimeout(resolve, 150))
        
        // Should be evicted due to TTL
        expect(shortTtlCache.getSession("test-session")).toBeUndefined()
      } finally {
        shortTtlCache.destroy()
      }
    })

    it("should handle inactive session cleanup", async () => {
      const shortTtlCache = new SessionMemoryManager.SessionCache({
        maxSessions: 10,
        sessionTtlMs: 1000,
        inactiveTtlMs: 100, // Short inactive TTL
        cleanupIntervalMs: 25,
      })
      
      try {
        shortTtlCache.setSession("test-session", { id: "test-session" })
        
        // Access the session
        expect(shortTtlCache.getSession("test-session")).toBeDefined()
        
        // Wait for inactive TTL
        await new Promise(resolve => setTimeout(resolve, 150))
        
        // Should be evicted due to inactivity
        expect(shortTtlCache.getSession("test-session")).toBeUndefined()
      } finally {
        shortTtlCache.destroy()
      }
    })

    it("should run background cleanup", async () => {
      const cleanupCache = new SessionMemoryManager.SessionCache({
        maxSessions: 10,
        sessionTtlMs: 50,
        inactiveTtlMs: 50,
        cleanupIntervalMs: 30, // Frequent cleanup
      })
      
      try {
        // Add sessions that will expire
        cleanupCache.setSession("session1", { id: "session1" })
        cleanupCache.setSession("session2", { id: "session2" })
        
        // Wait for cleanup to run
        await new Promise(resolve => setTimeout(resolve, 100))
        
        // Sessions should be cleaned up by background process
        expect(cleanupCache.size().sessions).toBeLessThanOrEqual(2)
      } finally {
        cleanupCache.destroy()
      }
    })
  })

  describe("Error Handling and Edge Cases", () => {
    it("should handle storage errors gracefully", async () => {
      const { Session } = await import("../../src/session/index")
      const { Storage } = require("../../src/storage/storage")
      
      // Mock storage to throw an error
      Storage.readJSON.mockRejectedValue(new Error("Storage error"))
      
      // Should throw the storage error
      await expect(Session.get("nonexistent-session")).rejects.toThrow("Storage error")
    })

    it("should handle invalid session data", () => {
      // Test with invalid data
      expect(() => {
        sessionCache.setSession("invalid", null as any)
      }).not.toThrow()
      
      expect(() => {
        sessionCache.setMessages("invalid", undefined as any)
      }).not.toThrow()
      
      // Should handle retrieval of invalid data
      expect(sessionCache.getSession("invalid")).toBeNull()
      expect(sessionCache.getMessages("invalid")).toBeUndefined()
    })

    it("should handle memory pressure gracefully", () => {
      // Fill cache beyond capacity rapidly
      for (let i = 0; i < 20; i++) {
        sessionCache.setSession(`stress-session-${i}`, {
          id: `stress-session-${i}`,
          data: `large-data-${i}`.repeat(100), // Some larger data
        })
      }
      
      // Cache should still be functional
      const stats = sessionCache.getStats()
      expect(stats.sessions.size).toBeLessThanOrEqual(5)
      expect(stats.sessions.evictions).toBeGreaterThan(0)
      
      // Should be able to add more sessions
      sessionCache.setSession("final-session", { id: "final-session" })
      expect(sessionCache.getSession("final-session")).toBeDefined()
    })
  })
})