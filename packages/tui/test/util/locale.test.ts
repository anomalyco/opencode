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
  expect(Locale.takeWidthEnd("ab界cd", 3)).toBe("cd")
  expect(Locale.graphemes("a👨‍👩‍👧‍👦b")).toEqual(["a", "👨‍👩‍👧‍👦", "b"])
})

test("truncates by display width without splitting graphemes", () => {
  expect(Locale.truncate("abcdefgh", 5)).toBe("abcd…")
  expect(Locale.truncate("ab界cd", 5)).toBe("ab界…")
  expect(Locale.truncate("こんにちは", 5)).toBe("こん…")
  expect(Locale.truncate("🚀🚀🚀", 4)).toBe("🚀…")
  expect(Locale.truncate("abcdefgh", 1)).toBe("…")
  expect(Locale.truncate("abcdefgh", 0)).toBe("")
  expect(Locale.truncate("abcdefgh", 8)).toBe("abcdefgh")
})

test("truncates from the left by display width", () => {
  expect(Locale.truncateLeft("abcdefgh", 5)).toBe("…efgh")
  expect(Locale.truncateLeft("ab界cd", 4)).toBe("…cd")
  expect(Locale.truncateLeft("abc🚀", 3)).toBe("…🚀")
  expect(Locale.truncateLeft("abcdefgh", 1)).toBe("…")
  expect(Locale.truncateLeft("abcdefgh", 0)).toBe("")
})

test("truncates the middle by display width", () => {
  expect(Locale.truncateMiddle("abcdefghijklmnop", 9)).toBe("abcd…mnop")
  expect(Locale.truncateMiddle("abcdefghijklmnop", 3)).toBe("a…p")
  expect(Locale.truncateMiddle("abcdefghijklmnop", 2)).toBe("a…")
  expect(Locale.truncateMiddle("abcdefghijklmnop", 1)).toBe("…")
  expect(Locale.truncateMiddle("a", 1)).toBe("a")
  expect(Locale.truncateMiddle("界", 1)).toBe("…")
  expect(Locale.truncateMiddle("", 1)).toBe("")
  expect(Locale.truncateMiddle("abcdefghijklmnop", 0)).toBe("")
  expect(Locale.truncateMiddle("こんにちは世界", 8)).toBe("こん…界")
  expect(Locale.truncateMiddle("abcdefgh", 9)).toBe("abcdefgh")
})

test("rolls the compact form over at the rounding boundary", () => {
  expect(Locale.number(999949)).toBe("999.9K")
  expect(Locale.number(999950)).toBe("1.0M")
  expect(Locale.number(1000000)).toBe("1.0M")
})
