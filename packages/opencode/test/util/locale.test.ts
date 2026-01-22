import { describe, expect, test } from "bun:test"
import { Locale } from "../../src/util/locale"

describe("util.locale", () => {
  describe("truncateFirstLine", () => {
    test("returns single line text without truncation when no maxLength", () => {
      const result = Locale.truncateFirstLine("Hello world")
      expect(result).toEqual("Hello world")
    })

    test("extracts first line from multiline text without maxLength", () => {
      const result = Locale.truncateFirstLine("First line\nSecond line\nThird line")
      expect(result).toEqual("First line")
    })

    test("returns empty string for empty input", () => {
      const result = Locale.truncateFirstLine("")
      expect(result).toEqual("")
    })

    test("returns single line when text is shorter than maxLength", () => {
      const result = Locale.truncateFirstLine("Short", 10)
      expect(result).toEqual("Short")
    })

    test("returns multiline text first line when shorter than maxLength", () => {
      const result = Locale.truncateFirstLine("Short\nSecond line", 10)
      expect(result).toEqual("Short")
    })

    test("truncates first line when it exceeds maxLength", () => {
      const result = Locale.truncateFirstLine("This is a very long line", 10)
      expect(result).toEqual("This is a…")
    })

    test("truncates first line of multiline text when it exceeds maxLength", () => {
      const result = Locale.truncateFirstLine("This is a very long line\nSecond line", 10)
      expect(result).toEqual("This is a…")
    })

    test("handles text exactly at maxLength", () => {
      const result = Locale.truncateFirstLine("Exactly10!", 10)
      expect(result).toEqual("Exactly10!")
    })

    test("handles multiline text with first line exactly at maxLength", () => {
      const result = Locale.truncateFirstLine("Exactly10!\nSecond line", 10)
      expect(result).toEqual("Exactly10!")
    })

    test("handles maxLength of 1", () => {
      const result = Locale.truncateFirstLine("Hello", 1)
      expect(result).toEqual("…")
    })

    test("handles text with only newline character", () => {
      const result = Locale.truncateFirstLine("\n")
      expect(result).toEqual("")
    })

    test("handles text with multiple consecutive newlines", () => {
      const result = Locale.truncateFirstLine("First\n\n\nFourth")
      expect(result).toEqual("First")
    })

    test("preserves spaces in first line", () => {
      const result = Locale.truncateFirstLine("  spaced text  \nSecond line")
      expect(result).toEqual("  spaced text  ")
    })

    test("handles unicode characters correctly with maxLength", () => {
      const result = Locale.truncateFirstLine("Hello 🌍🌎🌏", 8)
      expect(result).toEqual("Hello 🌍…")
    })

    test("handles text with carriage return and newline", () => {
      const result = Locale.truncateFirstLine("First line\r\nSecond line")
      expect(result).toEqual("First line\r")
    })
  })
})