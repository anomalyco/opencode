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

test("formats dates in the configured reply styles", () => {
  const value = new Date(2026, 10, 6, 21, 41).getTime()
  expect(Locale.date(value, "locale")).toBe(new Date(value).toLocaleDateString())
  expect(Locale.date(value, "friendly")).toBe("Nov 6, 2026")
  expect(Locale.date(value, "dd-mon-yyyy")).toBe("06-Nov-2026")
  expect(Locale.date(value, "iso")).toBe("2026-11-06")
  expect(Locale.datetime(value, "dd-mon-yyyy")).toBe(`${Locale.time(value)} · 06-Nov-2026`)
})

test("rolls the compact form over at the rounding boundary", () => {
  expect(Locale.number(999949)).toBe("999.9K")
  expect(Locale.number(999950)).toBe("1.0M")
  expect(Locale.number(1000000)).toBe("1.0M")
})

test("truncates text in the middle without overflowing small widths", () => {
  expect(Locale.truncateMiddle("abcdefghij", 0)).toBe("")
  expect(Locale.truncateMiddle("abcdefghij", 1)).toBe("…")
  expect(Locale.truncateMiddle("abcdefghij", 2)).toBe("a…")
  expect(Locale.truncateMiddle("abcdefghij", 3)).toBe("a…j")
  expect(Locale.truncateMiddle("abcdefghij", 4)).toBe("ab…j")
  expect(Locale.truncateMiddle("abcdefghij", 9)).toBe("abcd…ghij")
  expect(Locale.truncateMiddle("abcd", 4)).toBe("abcd")
  expect(Locale.truncateMiddle("abcd", 10)).toBe("abcd")
  expect(Locale.truncateMiddle("a", 1)).toBe("a")
})
