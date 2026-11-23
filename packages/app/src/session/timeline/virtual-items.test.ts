import { expect, test } from "bun:test"
import { isAboveFold } from "./virtual-items"

test("a row before the first visible one is above the fold", () => {
  expect(isAboveFold({ index: 1, end: 400 }, 2, 217)).toBe(true)
})

test("a visible row that ends under the sticky header is above the fold", () => {
  // Scrolled to 153 with a 64px header: a reply measured at 157 to 201 sits under the header.
  expect(isAboveFold({ index: 2, end: 201 }, 1, 217)).toBe(true)
  expect(isAboveFold({ index: 2, end: 217 }, 1, 217)).toBe(true)
})

test("a row that reaches below the header is not above the fold", () => {
  expect(isAboveFold({ index: 4, end: 218 }, 1, 217)).toBe(false)
})

test("nothing is above the fold before TanStack lists a range", () => {
  expect(isAboveFold({ index: 0, end: 10 }, undefined, 217)).toBe(false)
})
