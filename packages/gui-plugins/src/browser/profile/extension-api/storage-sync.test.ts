import { expect, test } from "bun:test"
import { pick, SYNC_QUOTA, syncQuotaError, syncRateError } from "./storage-sync"

test("get answers every item, the ones named, or the ones named with defaults", () => {
  const items = { theme: '"dark"', count: "3", rules: '["a"]' }

  expect(pick(items, null)).toEqual({ theme: "dark", count: 3, rules: ["a"] })
  expect(pick(items, "theme")).toEqual({ theme: "dark" })
  expect(pick(items, ["count", "missing"])).toEqual({ count: 3 })
  expect(pick(items, { count: 0, missing: "fallback" })).toEqual({ count: 3, missing: "fallback" })
  // Keys of Object.prototype are not items.
  expect(pick(items, ["toString", "constructor"])).toEqual({})
})

test("a write past Chrome's quotas is refused; one that only shrinks is not", () => {
  const big = "x".repeat(SYNC_QUOTA.QUOTA_BYTES_PER_ITEM)
  const many = Object.fromEntries(Array.from({ length: SYNC_QUOTA.MAX_ITEMS }, (_, index) => [`k${index}`, "1"]))
  const full = Object.fromEntries(Array.from({ length: 13 }, (_, index) => [`k${index}`, "y".repeat(8000)]))

  expect(syncQuotaError({}, { a: big }, ["a"])).toBe("QUOTA_BYTES_PER_ITEM quota exceeded")
  expect(syncQuotaError(many, { ...many, extra: "1" }, ["extra"])).toBe("MAX_ITEMS quota exceeded")
  expect(syncQuotaError({}, full, Object.keys(full))).toBe("QUOTA_BYTES quota exceeded")
  expect(syncQuotaError({ ...many, extra: "1" }, many, [])).toBeUndefined()
  expect(syncQuotaError({}, { a: '"small"' }, ["a"])).toBeUndefined()
})

test("writes are limited per minute and per hour", () => {
  const now = 10_000_000
  const minute = Array.from({ length: SYNC_QUOTA.MAX_WRITE_OPERATIONS_PER_MINUTE }, (_, index) => now - index)
  const hour = Array.from({ length: SYNC_QUOTA.MAX_WRITE_OPERATIONS_PER_HOUR }, (_, index) => now - 61_000 - index)

  expect(syncRateError(minute, now)).toBe("MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded")
  expect(syncRateError(minute, now + 60_000)).toBeUndefined()
  expect(syncRateError(hour, now)).toBe("MAX_WRITE_OPERATIONS_PER_HOUR quota exceeded")
})
