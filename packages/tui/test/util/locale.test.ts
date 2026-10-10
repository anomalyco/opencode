import { expect, test } from "bun:test"
import { Locale } from "../../src/util/locale"

test("truncates text from the right by terminal width", () => {
  expect(Locale.truncateWidth("abcdefgh", 5)).toBe("abcd…")
  expect(Locale.truncateWidth("ab界cd", 5)).toBe("ab界…")
  expect(Locale.truncateWidth("abcdefgh", 1)).toBe("…")
  expect(Locale.truncateWidth("abcdefgh", 0)).toBe("")
})

test("takes whole graphemes within terminal width", () => {
  expect(Locale.takeWidth("ab界cd", 4)).toBe("ab界")
  expect(Locale.graphemes("a👨‍👩‍👧‍👦b")).toEqual(["a", "👨‍👩‍👧‍👦", "b"])
})

test("formats USD cost with adaptive precision", () => {
  expect(Locale.formatCost(undefined)).toBe("—")
  expect(Locale.formatCost(0)).toBe("$0.00")
  expect(Locale.formatCost(12.5)).toBe("$12.50")
  expect(Locale.formatCost(0.5)).toBe("$0.50")
  expect(Locale.formatCost(0.005)).toBe("$0.005")
  expect(Locale.formatCost(0.0012)).toBe("$0.001")
  expect(Locale.formatCost(0.00046)).toBe("$0.0004")
  expect(Locale.formatCost(0.0001)).toBe("$0.0001")
  expect(Locale.formatCost(0.00003)).toBe("$0.00003")
})

test("centers text within a column width", () => {
  expect(Locale.padCenter("Cost", 4)).toBe("Cost")
  expect(Locale.padCenter("Cost", 8)).toBe("  Cost  ")
  expect(Locale.padCenter("Cost", 9)).toBe("  Cost   ")
  expect(Locale.padCenter("Cost", 2)).toBe("Cost")
})
