import { expect, test } from "bun:test"
import { sessionTabTitle } from "./tab-title"

test.each([
  [undefined, "Session", "Session"],
  ["", "Sitzung", "Sitzung"],
  ["New session - 2026-07-30T18:45:03.662Z", "Session", "Session"],
  ["Child session - 2026-07-30T18:45:03.662Z", "Sitzung", "Sitzung"],
  ["Generated title", "Session", "Generated title"],
  ["New session", "Session", "New session"],
  ["New session - custom", "Session", "New session - custom"],
])("session tab title %p with fallback %p is %p", (title, fallback, expected) => {
  expect(sessionTabTitle(title, fallback)).toBe(expected)
})
