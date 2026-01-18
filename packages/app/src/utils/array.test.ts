import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import { createRoot } from "solid-js"

/**
 * Tests for handling SolidJS store proxy arrays.
 *
 * SolidJS store proxies may not pass Array.isArray() checks in browser environments
 * (they do pass in server/test environments). These tests verify that our array
 * detection approach using typeof .filter === "function" works in all cases.
 */
describe("SolidJS store proxy array handling", () => {
  test("Array.isArray behavior varies by environment (browser vs server)", () => {
    createRoot((dispose) => {
      const [store] = createStore({ items: [1, 2, 3] })

      // In server/test mode, Array.isArray returns true
      // In browser with proxies, it may return false
      // Our code should handle both cases
      const isArray = Array.isArray(store.items)
      expect(typeof isArray).toBe("boolean")

      dispose()
    })
  })

  test("typeof .filter === 'function' works for store proxy arrays", () => {
    createRoot((dispose) => {
      const [store] = createStore({ items: [1, 2, 3] })

      // This is our solution: check for array methods instead
      expect(typeof store.items.filter).toBe("function")
      expect(typeof store.items.map).toBe("function")
      expect(typeof store.items.length).toBe("number")

      dispose()
    })
  })

  test("store proxy arrays can be filtered and mapped", () => {
    createRoot((dispose) => {
      const [store] = createStore({
        items: [
          { id: 1, active: true },
          { id: 2, active: false },
          { id: 3, active: true },
        ],
      })

      // Verify filtering works
      const active = store.items.filter((x) => x.active)
      expect(active.length).toBe(2)
      expect(active[0].id).toBe(1)
      expect(active[1].id).toBe(3)

      // Verify mapping works
      const ids = store.items.map((x) => x.id)
      expect(ids).toEqual([1, 2, 3])

      dispose()
    })
  })

  test("isArrayLike helper function", () => {
    // Helper function that works with both real arrays and store proxies
    const isArrayLike = (value: unknown): value is unknown[] =>
      !!value && typeof value === "object" && typeof (value as { filter?: unknown }).filter === "function"

    createRoot((dispose) => {
      const [store] = createStore({ items: [1, 2, 3] })

      // Works for store proxy
      expect(isArrayLike(store.items)).toBe(true)

      // Works for real array
      expect(isArrayLike([1, 2, 3])).toBe(true)

      // Returns false for non-arrays
      expect(isArrayLike(null)).toBe(false)
      expect(isArrayLike(undefined)).toBe(false)
      expect(isArrayLike({})).toBe(false)
      expect(isArrayLike("string")).toBe(false)
      expect(isArrayLike(123)).toBe(false)

      dispose()
    })
  })

  test("empty store proxy arrays", () => {
    createRoot((dispose) => {
      const [store] = createStore({ items: [] as number[] })

      expect(typeof store.items.filter).toBe("function")
      expect(store.items.length).toBe(0)
      expect(store.items.filter((x) => x > 0)).toEqual([])

      dispose()
    })
  })

  test("nested store proxy arrays", () => {
    createRoot((dispose) => {
      const [store] = createStore({
        projects: [
          { name: "foo", sessions: [{ id: "s1" }, { id: "s2" }] },
          { name: "bar", sessions: [{ id: "s3" }] },
        ],
      })

      // Top-level array
      expect(typeof store.projects.filter).toBe("function")

      // Nested arrays
      expect(typeof store.projects[0].sessions.filter).toBe("function")
      expect(store.projects[0].sessions.length).toBe(2)

      // Filtering nested arrays
      const allSessions = store.projects.flatMap((p) => p.sessions)
      expect(allSessions.length).toBe(3)

      dispose()
    })
  })
})
