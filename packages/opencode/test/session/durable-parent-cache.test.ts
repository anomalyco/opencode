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
