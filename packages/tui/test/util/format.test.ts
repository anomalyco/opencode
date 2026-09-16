import { describe, expect, test } from "bun:test"
import { formatAnswer, formatDuration } from "../../src/util/format"

describe("util.format", () => {
  describe("formatDuration", () => {
    test("returns empty string for zero or negative values", () => {
      expect(formatDuration(0)).toBe("")
      expect(formatDuration(-1)).toBe("")
      expect(formatDuration(-100)).toBe("")
    })

    test("formats seconds under a minute", () => {
      expect(formatDuration(1)).toBe("1s")
      expect(formatDuration(30)).toBe("30s")
      expect(formatDuration(59)).toBe("59s")
    })

    test("formats minutes under an hour", () => {
      expect(formatDuration(60)).toBe("1m")
      expect(formatDuration(61)).toBe("1m 1s")
      expect(formatDuration(90)).toBe("1m 30s")
      expect(formatDuration(120)).toBe("2m")
      expect(formatDuration(330)).toBe("5m 30s")
      expect(formatDuration(3599)).toBe("59m 59s")
    })

    test("formats hours under a day", () => {
      expect(formatDuration(3600)).toBe("1h")
      expect(formatDuration(3660)).toBe("1h 1m")
      expect(formatDuration(7200)).toBe("2h")
      expect(formatDuration(8100)).toBe("2h 15m")
      expect(formatDuration(86399)).toBe("23h 59m")
    })

    test("formats days under a week", () => {
      expect(formatDuration(86400)).toBe("~1 day")
      expect(formatDuration(172800)).toBe("~2 days")
      expect(formatDuration(259200)).toBe("~3 days")
      expect(formatDuration(604799)).toBe("~6 days")
    })

    test("formats weeks", () => {
      expect(formatDuration(604800)).toBe("~1 week")
      expect(formatDuration(1209600)).toBe("~2 weeks")
      expect(formatDuration(1609200)).toBe("~2 weeks")
    })

    test("handles boundary values correctly", () => {
      expect(formatDuration(59)).toBe("59s")
      expect(formatDuration(60)).toBe("1m")
      expect(formatDuration(3599)).toBe("59m 59s")
      expect(formatDuration(3600)).toBe("1h")
      expect(formatDuration(86399)).toBe("23h 59m")
      expect(formatDuration(86400)).toBe("~1 day")
      expect(formatDuration(604799)).toBe("~6 days")
      expect(formatDuration(604800)).toBe("~1 week")
    })
  })

  describe("formatAnswer", () => {
    test("keeps prose text unchanged", () => {
      expect(formatAnswer("hello world")).toBe("hello world")
      expect(formatAnswer("")).toBe("")
    })

    test("trims trailing whitespace outside code blocks", () => {
      expect(formatAnswer("hello   \nworld\t ")).toBe("hello\nworld")
    })

    test("collapses repeated blank lines and trims ends", () => {
      expect(formatAnswer("\n\na\n\n\n\nb\n\n")).toBe("a\n\nb")
    })

    test("preserves fenced code blocks byte-for-byte", () => {
      const code = "```js\nline one   \n\n\nline two\t\n```"
      expect(formatAnswer(`before   \n\n${code}\n\nafter   `)).toBe(`before\n\n${code}\n\nafter`)
    })

    test("treats unclosed fences as code to the end", () => {
      expect(formatAnswer("text   \n```\nkeep   \n\n\nkeep")).toBe("text\n```\nkeep   \n\n\nkeep")
    })
  })
})
