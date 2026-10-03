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

test("formats compact numbers and rolls over to M at the rounding boundary", () => {
  expect(Locale.number(999)).toBe("999")
  expect(Locale.number(1500)).toBe("1.5K")
  expect(Locale.number(999949)).toBe("999.9K")
  expect(Locale.number(999950)).toBe("1.0M")
  expect(Locale.number(999999)).toBe("1.0M")
  expect(Locale.number(2500000)).toBe("2.5M")
})
