import { expect, test } from "bun:test"
import { findView, initialFind, transitionFind } from "./find-machine"

test("late matches cannot replace the new query's count or reopen a dismissed search", () => {
  const opened = transitionFind(initialFind, { type: "open" })
  const edited = transitionFind(opened, { type: "query", query: "first" })
  const first = transitionFind(edited, { type: "issued", id: 8 })
  const next = transitionFind(first, { type: "query", query: "other" })
  const search = transitionFind(next, { type: "issued", id: 9 })

  const result = {
    requestId: 8,
    finalUpdate: true,
    matches: 4,
    activeMatchOrdinal: 2,
    selectionArea: { x: 0, y: 0, width: 1, height: 1 },
  }

  expect(transitionFind(next, { type: "found", result })).toBe(next)
  expect(transitionFind(search, { type: "found", result })).toBe(search)
  expect(transitionFind(search, { type: "found", result: { ...result, requestId: 9, finalUpdate: false } })).toBe(
    search,
  )
  const found = transitionFind(search, { type: "found", result: { ...result, requestId: 9 } })
  expect(findView(found)).toEqual({ query: "other", result: { active: 2, total: 4 } })
  const closed = transitionFind(found, { type: "close" })
  expect(transitionFind(closed, { type: "found", result })).toBe(closed)
  expect(findView(transitionFind(closed, { type: "open" }))).toEqual({ query: "other", result: null })
})
