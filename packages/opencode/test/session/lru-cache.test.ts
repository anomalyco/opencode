import { describe, expect, test } from "bun:test"
import { createLruCache } from "@/session/lru-cache"

describe("session lru cache", () => {
  test("evicts the least-recently-used entry once past capacity", () => {
    const cache = createLruCache<number, number>(8)
    for (let i = 0; i < 8; i++) cache.set(i, i)
    expect(cache.size).toBe(8)

    cache.set(8, 8)
    expect(cache.size).toBe(8)
    expect(cache.get(0)).toBeUndefined()
    expect(cache.get(8)).toBe(8)
  })

  test("a hit refreshes recency so the hottest entry survives eviction", () => {
    const cache = createLruCache<number, number>(8)
    for (let i = 0; i < 8; i++) cache.set(i, i)
    expect(cache.get(0)).toBe(0)

    cache.set(8, 8)
    expect(cache.get(0)).toBe(0)
    expect(cache.get(1)).toBeUndefined()
    expect(cache.get(8)).toBe(8)
  })
})
