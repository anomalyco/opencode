import { test, expect } from "bun:test"
import { LRUCache } from "../../src/util/cache"

test("LRUCache: basic get/set operations", async () => {
  const cache = new LRUCache<string>({
    namespace: "test-basic",
    maxSize: 10,
    ttl: 60000,
    persist: false,
  })

  await cache.set("key1", "value1")
  const result = await cache.get("key1")
  expect(result).toBe("value1")

  const missing = await cache.get("nonexistent")
  expect(missing).toBeUndefined()
})

test("LRUCache: respects maxSize and evicts oldest", async () => {
  const cache = new LRUCache<string>({
    namespace: "test-eviction",
    maxSize: 3,
    ttl: 60000,
    persist: false,
  })

  await cache.set("key1", "value1")
  await cache.set("key2", "value2")
  await cache.set("key3", "value3")
  await cache.set("key4", "value4")

  expect(await cache.get("key1")).toBeUndefined()
  expect(await cache.get("key2")).toBe("value2")
  expect(await cache.get("key3")).toBe("value3")
  expect(await cache.get("key4")).toBe("value4")
})

test("LRUCache: TTL expiration", async () => {
  const cache = new LRUCache<string>({
    namespace: "test-ttl",
    maxSize: 10,
    ttl: 50,
    persist: false,
  })

  await cache.set("key1", "value1")
  expect(await cache.get("key1")).toBe("value1")

  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(await cache.get("key1")).toBeUndefined()
})

test("LRUCache: stats reporting with namespace", async () => {
  const cache = new LRUCache<string>({
    namespace: "test-stats-ns",
    maxSize: 100,
    ttl: 60000,
    persist: false,
  })

  await cache.set("key1", "value1")
  await cache.set("key2", "value2")

  const stats = cache.stats()
  expect(stats.namespace).toBe("test-stats-ns")
  expect(stats.memorySize).toBe(2)
  expect(stats.maxSize).toBe(100)
})

test("LRUCache: hit/miss counters", async () => {
  const cache = new LRUCache<string>({
    namespace: "test-counters",
    maxSize: 10,
    ttl: 60000,
    persist: false,
  })

  // Initial state - no hits or misses
  let stats = cache.stats()
  expect(stats.hits).toBe(0)
  expect(stats.misses).toBe(0)
  expect(stats.hitRate).toBe(0)

  // Set a value
  await cache.set("key1", "value1")

  // Get existing key - should be a hit
  await cache.get("key1")
  stats = cache.stats()
  expect(stats.hits).toBe(1)
  expect(stats.misses).toBe(0)
  expect(stats.hitRate).toBe(1)

  // Get non-existent key - should be a miss
  await cache.get("nonexistent")
  stats = cache.stats()
  expect(stats.hits).toBe(1)
  expect(stats.misses).toBe(1)
  expect(stats.hitRate).toBe(0.5)

  // Another hit
  await cache.get("key1")
  stats = cache.stats()
  expect(stats.hits).toBe(2)
  expect(stats.misses).toBe(1)
  expect(stats.hitRate).toBeCloseTo(0.666, 2)
})

test("LRUCache: clear resets counters", async () => {
  const cache = new LRUCache<string>({
    namespace: "test-clear-counters",
    maxSize: 10,
    ttl: 60000,
    persist: false,
  })

  await cache.set("key1", "value1")
  await cache.get("key1") // hit
  await cache.get("missing") // miss

  let stats = cache.stats()
  expect(stats.hits).toBe(1)
  expect(stats.misses).toBe(1)

  await cache.clear()

  stats = cache.stats()
  expect(stats.hits).toBe(0)
  expect(stats.misses).toBe(0)
  expect(stats.memorySize).toBe(0)
})

test("LRUCache: expired entries count as misses", async () => {
  const cache = new LRUCache<string>({
    namespace: "test-expired-miss",
    maxSize: 10,
    ttl: 50, // 50ms TTL
    persist: false,
  })

  await cache.set("key1", "value1")

  // Hit while fresh
  await cache.get("key1")
  let stats = cache.stats()
  expect(stats.hits).toBe(1)
  expect(stats.misses).toBe(0)

  // Wait for expiration
  await new Promise((resolve) => setTimeout(resolve, 100))

  // Miss due to expiration
  await cache.get("key1")
  stats = cache.stats()
  expect(stats.hits).toBe(1)
  expect(stats.misses).toBe(1)
})
