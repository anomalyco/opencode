import { expect, test } from "bun:test"
import { relativeTime } from "./relative-time"

const created = 1_735_689_600_000

const minute = 60_000

test("rounds down to the largest whole unit under a week", () => {
  expect(relativeTime(created, created + 59_999)).toEqual({ unit: "now" })
  expect(relativeTime(created, created + 2 * minute + 59_999)).toEqual({ unit: "minute", count: 2 })
  expect(relativeTime(created, created + 90 * minute)).toEqual({ unit: "hour", count: 1 })
  expect(relativeTime(created, created + 3 * 24 * 60 * minute)).toEqual({ unit: "day", count: 3 })
})

test("falls back to the date after a week and treats clock skew as now", () => {
  expect(relativeTime(created, created + 7 * 24 * 60 * minute)).toEqual({ unit: "date" })
  expect(relativeTime(created, created - minute)).toEqual({ unit: "now" })
})
