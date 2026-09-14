import { expect, test } from "bun:test"
import { createDurableParentCache } from "@/session/durable-parent-cache"

test("evicts the least recently used identity past capacity", () => {
  const cache = createDurableParentCache(2)
  cache.add("ses:a")
  cache.add("ses:b")

  cache.add("ses:c")

  expect(cache.size).toBe(2)
  expect(cache.has("ses:a")).toBe(false)
  expect(cache.has("ses:b")).toBe(true)
  expect(cache.has("ses:c")).toBe(true)
})

test("refreshes recency when a cached identity is read", () => {
  const cache = createDurableParentCache(2)
  cache.add("ses:a")
  cache.add("ses:b")

  expect(cache.has("ses:a")).toBe(true)
  cache.add("ses:c")

  expect(cache.size).toBe(2)
  expect(cache.has("ses:a")).toBe(true)
  expect(cache.has("ses:b")).toBe(false)
})

test("bounds the production default capacity and evicts the oldest identity", () => {
  // Construct exactly as SessionSummary does: no explicit capacity. The expected bound is a literal
  // so this fails if the production default becomes unbounded.
  const cache = createDurableParentCache()
  Array.from({ length: 5000 }, (_, index) => `ses:${index}`).forEach((key) => cache.add(key))

  expect(cache.size).toBe(4096)
  expect(cache.has("ses:0")).toBe(false)
  expect(cache.has("ses:4999")).toBe(true)
})
