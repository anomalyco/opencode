import { expect, test } from "bun:test"
import { pick } from "./storage-sync"

test("get answers every item, the ones named, or the ones named with defaults", () => {
  const items = { theme: '"dark"', count: "3", rules: '["a"]' }

  expect(pick(items, null)).toEqual({ theme: "dark", count: 3, rules: ["a"] })
  expect(pick(items, "theme")).toEqual({ theme: "dark" })
  expect(pick(items, ["count", "missing"])).toEqual({ count: 3 })
  expect(pick(items, { count: 0, missing: "fallback" })).toEqual({ count: 3, missing: "fallback" })
})
