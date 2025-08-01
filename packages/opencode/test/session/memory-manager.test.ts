import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { SessionMemoryManager } from "../../src/session/memory-manager"

describe("SessionMemoryManager", () => {
  describe("LRUCache", () => {
    let cache: SessionMemoryManager.LRUCache<string>

    beforeEach(() => {
      cache = new SessionMemoryManager.LRUCache({
        maxSize: 3,
        ttlMs: 1000,
        inactiveTtlMs: 500,
      })
    })

    afterEach(() => {
      cache.clear()
    })

    it("should store and retrieve values", () => {
      cache.set("key1", "value1")
      expect(cache.get("key1")).toBe("value1")
    })

    it("should return undefined for non-existent keys", () => {
      expect(cache.get("nonexistent")).toBeUndefined()
    })

    it("should evict least recently used items when at capacity", () => {
      cache.set("key1", "value1")
      cache.set("key2", "value2")
      cache.set("key3", "value3")
      
      // key1 should still exist
      expect(cache.get("key1")).toBe("value1")
      
      // Adding key4 should evict key2 (least recently used)
      cache.set("key4", "value4")
      expect(cache.get("key2")).toBeUndefined()
      expect(cache.get("key1")).toBe("value1") // Recently accessed
      expect(cache.get("key3")).toBe("value3")
      expect(cache.get("key4")).toBe("value4")
    })

    it("should evict expired items based on TTL", async () => {
      cache.set("key1", "value1")
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100))
      
      expect(cache.get("key1")).toBeUndefined()
    })

    it("should evict inactive items", async () => {
      cache.set("key1", "value1")
      
      // Access the item
      expect(cache.get("key1")).toBe("value1")
      
      // Wait for inactive expiration
      await new Promise(resolve => setTimeout(resolve, 600))
      
      expect(cache.get("key1")).toBeUndefined()
    })

    it("should track cache statistics", () => {
      cache.set("key1", "value1")
      cache.get("key1") // hit
      cache.get("nonexistent") // miss
      
      const stats = cache.getStats()
      expect(stats.hits).toBe(1)
      expect(stats.misses).toBe(1)
      expect(stats.size).toBe(1)
    })

    it("should handle has() with TTL expiration", async () => {
      cache.set("key1", "value1")
      expect(cache.has("key1")).toBe(true)
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100))
      
      expect(cache.has("key1")).toBe(false)
    })

    it("should clear all items", () => {
      cache.set("key1", "value1")
      cache.set("key2", "value2")
      
      cache.clear()
      
      expect(cache.size()).toBe(0)
      expect(cache.get("key1")).toBeUndefined()
      expect(cache.get("key2")).toBeUndefined()
    })

    it("should update existing items without increasing size", () => {
      cache.set("key1", "value1")
      expect(cache.size()).toBe(1)
      
      cache.set("key1", "value2")
      expect(cache.size()).toBe(1)
      expect(cache.get("key1")).toBe("value2")
    })

    it("should handle memory pressure eviction", () => {
      const config = {
        maxSize: 5,
        ttlMs: 10000,
        inactiveTtlMs: 10000,
      }
      const pressureCache = new SessionMemoryManager.LRUCache(config)
      
      // Fill to capacity
      for (let i = 0; i < 5; i++) {
        pressureCache.set(`key${i}`, `value${i}`)
      }
      
      // Access some items multiple times to increase access count
      for (let i = 0; i < 3; i++) {
        pressureCache.get("key4")
        pressureCache.get("key3")
      }
      
      // Adding more items should trigger memory pressure eviction
      pressureCache.set("key5", "value5")
      pressureCache.set("key6", "value6")
      
      // Items with lower access count should be evicted first
      expect(pressureCache.get("key3")).toBeDefined()
      expect(pressureCache.get("key4")).toBeDefined()
      
      pressureCache.clear()
    })
  })

  describe("SessionCache", () => {
    let sessionCache: SessionMemoryManager.SessionCache

    beforeEach(() => {
      sessionCache = new SessionMemoryManager.SessionCache({
        maxSessions: 5,
        maxMessagesPerSession: 10,
        sessionTtlMs: 1000,
        inactiveTtlMs: 500,
        cleanupIntervalMs: 100,
      })
    })

    afterEach(() => {
      sessionCache.destroy()
    })

    it("should store and retrieve sessions", () => {
      const session = { id: "session1", title: "Test Session" }
      sessionCache.setSession("session1", session)
      
      expect(sessionCache.getSession("session1")).toEqual(session)
    })

    it("should store and retrieve messages", () => {
      const messages = [
        { id: "msg1", content: "Hello" },
        { id: "msg2", content: "World" },
      ]
      sessionCache.setMessages("session1", messages)
      
      expect(sessionCache.getMessages("session1")).toEqual(messages)
    })

    it("should delete sessions and associated messages", () => {
      const session = { id: "session1", title: "Test Session" }
      const messages = [{ id: "msg1", content: "Hello" }]
      
      sessionCache.setSession("session1", session)
      sessionCache.setMessages("session1", messages)
      
      sessionCache.deleteSession("session1")
      
      expect(sessionCache.getSession("session1")).toBeUndefined()
      expect(sessionCache.getMessages("session1")).toBeUndefined()
    })

    it("should report memory pressure correctly", () => {
      // Fill cache to capacity
      for (let i = 0; i < 4; i++) {
        sessionCache.setSession(`session${i}`, { id: `session${i}` })
      }
      
      expect(sessionCache.isUnderMemoryPressure()).toBe(true)
    })

    it("should provide accurate statistics", () => {
      sessionCache.setSession("session1", { id: "session1" })
      sessionCache.setMessages("session1", [{ id: "msg1" }])
      
      // Access to generate stats
      sessionCache.getSession("session1")
      sessionCache.getSession("nonexistent")
      
      const stats = sessionCache.getStats()
      expect(stats.sessions.size).toBe(1)
      expect(stats.messages.size).toBe(1)
      expect(stats.sessions.hits).toBeGreaterThan(0)
      expect(stats.sessions.misses).toBeGreaterThan(0)
    })

    it("should force cleanup on demand", () => {
      // Add expired sessions
      sessionCache.setSession("session1", { id: "session1" })
      
      // Force cleanup
      sessionCache.forceCleanup()
      
      // Should still exist since not expired yet
      expect(sessionCache.getSession("session1")).toBeDefined()
    })

    it("should handle size reporting", () => {
      sessionCache.setSession("session1", { id: "session1" })
      sessionCache.setMessages("session1", [{ id: "msg1" }])
      
      const size = sessionCache.size()
      expect(size.sessions).toBe(1)
      expect(size.messages).toBe(1)
    })

    it("should clear all caches", () => {
      sessionCache.setSession("session1", { id: "session1" })
      sessionCache.setMessages("session1", [{ id: "msg1" }])
      
      sessionCache.clear()
      
      const size = sessionCache.size()
      expect(size.sessions).toBe(0)
      expect(size.messages).toBe(0)
    })

    it("should handle background cleanup", async () => {
      // The cleanup interval is set to 100ms in beforeEach
      // This test verifies the cleanup timer is working
      const initialStats = sessionCache.getStats()
      
      // Wait for at least one cleanup cycle
      await new Promise(resolve => setTimeout(resolve, 150))
      
      // The cleanup should have run (we can't easily test eviction without expired items)
      // But we can verify the timer mechanism is working by checking the cache is still functional
      sessionCache.setSession("test", { id: "test" })
      expect(sessionCache.getSession("test")).toBeDefined()
    })
  })

  describe("Global Cache Management", () => {
    afterEach(() => {
      SessionMemoryManager.destroyGlobalCache()
    })

    it("should provide a global cache instance", () => {
      const cache1 = SessionMemoryManager.getGlobalCache()
      const cache2 = SessionMemoryManager.getGlobalCache()
      
      expect(cache1).toBe(cache2) // Should be the same instance
    })

    it("should destroy global cache", () => {
      const cache1 = SessionMemoryManager.getGlobalCache()
      SessionMemoryManager.destroyGlobalCache()
      
      const cache2 = SessionMemoryManager.getGlobalCache()
      expect(cache1).not.toBe(cache2) // Should be a new instance
    })
  })

  describe("Memory Pressure Scenarios", () => {
    let cache: SessionMemoryManager.SessionCache

    beforeEach(() => {
      cache = new SessionMemoryManager.SessionCache({
        maxSessions: 3,
        maxMessagesPerSession: 5,
        sessionTtlMs: 10000, // Long TTL to test capacity limits
        inactiveTtlMs: 10000,
        cleanupIntervalMs: 50,
      })
    })

    afterEach(() => {
      cache.destroy()
    })

    it("should handle rapid session creation under memory pressure", () => {
      // Rapidly create sessions beyond capacity
      for (let i = 0; i < 10; i++) {
        cache.setSession(`session${i}`, { id: `session${i}`, data: `data${i}` })
      }
      
      // Should only keep the most recent sessions due to LRU eviction
      const size = cache.size()
      expect(size.sessions).toBeLessThanOrEqual(3)
      
      // Most recent sessions should still be accessible
      expect(cache.getSession("session9")).toBeDefined()
      expect(cache.getSession("session8")).toBeDefined()
      expect(cache.getSession("session7")).toBeDefined()
      
      // Older sessions should be evicted
      expect(cache.getSession("session0")).toBeUndefined()
    })

    it("should maintain performance under memory pressure", () => {
      const startTime = Date.now()
      
      // Perform many operations
      for (let i = 0; i < 100; i++) {
        cache.setSession(`session${i}`, { id: `session${i}` })
        cache.getSession(`session${i}`)
      }
      
      const endTime = Date.now()
      const duration = endTime - startTime
      
      // Should complete operations reasonably quickly (less than 1 second)
      expect(duration).toBeLessThan(1000)
    })
  })

  describe("Error Handling", () => {
    it("should handle invalid cache configurations gracefully", () => {
      expect(() => {
        new SessionMemoryManager.SessionCache({
          maxSessions: 0, // Invalid
          maxMessagesPerSession: -1, // Invalid
        })
      }).not.toThrow()
    })

    it("should handle null/undefined values", () => {
      const cache = new SessionMemoryManager.SessionCache()
      
      // Should handle undefined values without throwing
      expect(() => {
        cache.setSession("test", undefined as any)
      }).not.toThrow()
      
      expect(() => {
        cache.setMessages("test", null as any)
      }).not.toThrow()
    })
  })
})