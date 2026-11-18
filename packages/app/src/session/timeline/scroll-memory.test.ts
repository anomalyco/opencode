import { expect, test } from "bun:test"
import { anchorAt, recallScroll, rememberScroll } from "./scroll-memory"

const items = [
  { key: "a", start: 0, end: 100 },
  { key: "b", start: 100, end: 220 },
  { key: "c", start: 220, end: 400 },
]

test.each([
  { name: "the row under the viewport top", offset: 130, anchorKey: "b", delta: -30 },
  { name: "the row a boundary opens", offset: 100, anchorKey: "b", delta: 0 },
  { name: "the first row at the top", offset: 0, anchorKey: "a", delta: 0 },
  // The tail spacer below the last row keeps the last row visible.
  { name: "past the last row", offset: 500, anchorKey: "c", delta: -280 },
])("anchors $name", ({ offset, anchorKey, delta }) => {
  const anchor = anchorAt(items, offset)

  expect(anchor?.anchorKey).toBe(anchorKey)
  expect(anchor?.delta).toBe(delta)
})

test("has no anchor without rows", () => {
  expect(anchorAt([], 0)).toBeUndefined()
})

test("merges the follow flag and the anchor for one session", () => {
  rememberScroll("merge/session", { anchorKey: "row-1", delta: 12 })
  rememberScroll("merge/session", { following: false })

  expect(recallScroll("merge/session")).toEqual({ anchorKey: "row-1", delta: 12, following: false })
})

test("keeps the most recent sixty-four sessions", () => {
  for (let index = 0; index < 65; index++) rememberScroll(`cap/session-${index}`, { following: true })

  expect(recallScroll("cap/session-0")).toBeUndefined()
  expect(recallScroll("cap/session-64")).toEqual({ following: true })
})
