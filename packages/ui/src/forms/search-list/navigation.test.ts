import { expect, test } from "bun:test"
import { searchListMove, searchListTarget, type SearchListMove } from "./navigation"

const key = (key: string, modifiers: { metaKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
})

test("⌘ and ⌥ arrows jump sections, Home and End reach the ends, and Shift stays with the input", () => {
  expect(searchListMove(key("ArrowDown"))).toBe("next")
  expect(searchListMove(key("ArrowDown", { metaKey: true }))).toBe("nextSection")
  expect(searchListMove(key("ArrowUp", { altKey: true }))).toBe("previousSection")
  expect(searchListMove(key("Home"))).toBe("first")
  expect(searchListMove(key("End", { shiftKey: true }))).toBeUndefined()
  expect(searchListMove(key("Home", { metaKey: true }))).toBeUndefined()
})

// Sections a a | b | c c c, so rows 0–1, 2 and 3–5.
const sections = ["a", "a", "b", "c", "c", "c"]

test.each<[number, SearchListMove, number]>([
  [0, "nextSection", 2],
  [1, "nextSection", 2],
  [2, "nextSection", 3],
  [4, "nextSection", 0],
  [4, "previousSection", 3],
  [3, "previousSection", 2],
  [2, "previousSection", 0],
  [0, "previousSection", 3],
  [5, "next", 0],
  [0, "previous", 5],
  [3, "first", 0],
  [1, "last", 5],
])("from row %i, %s lands on row %i", (from, move, to) => {
  expect(searchListTarget(sections, from, move)).toBe(to)
})
