import { describe, expect, test } from "bun:test"
import { truncate, truncateLeft, truncateMiddle } from "../../src/util/locale"

describe("util.locale", () => {
  describe("truncate", () => {
    test("returns strings unchanged when they fit", () => {
      expect(truncate("hello", 10)).toBe("hello")
      expect(truncate("hello", 5)).toBe("hello")
    })

    test("truncates ASCII strings by display width", () => {
      const result = truncate("Sisyphus: Ultraworker", 10)
      expect(result).toBe("Sisyphus:…")
      expect(Bun.stringWidth(result)).toBe(10)
    })

    test("does not truncate invisible-prefixed strings when their display width fits", () => {
      const input = "\u200BSisyphus"
      expect(Bun.stringWidth(input)).toBe(8)
      expect(truncate(input, 8)).toBe(input)
    })

    test("truncates invisible-prefixed strings at the visible boundary", () => {
      const input = "\u200BSisyphus: Ultraworker"
      const result = truncate(input, 10)
      expect(result).toBe("\u200BSisyphus:…")
      expect(Bun.stringWidth(result)).toBe(10)
    })

    test("handles common zero-width codepoints", () => {
      for (const prefix of ["\u200B", "\u200C", "\u200D", "\uFEFF"]) {
        const result = truncate(`${prefix}Sisyphus: Ultraworker`, 10)
        expect(result).toBe(`${prefix}Sisyphus:…`)
        expect(Bun.stringWidth(result)).toBe(10)
      }
    })
  })

  describe("truncateLeft", () => {
    test("truncates from the left by display width", () => {
      const result = truncateLeft("\u200BSisyphus: Ultraworker", 10)
      expect(result).toBe("…traworker")
      expect(Bun.stringWidth(result)).toBe(10)
    })

    test("keeps strings unchanged when invisible codepoints fit", () => {
      const input = "\u200Bhello"
      expect(truncateLeft(input, 5)).toBe(input)
    })
  })

  describe("truncateMiddle", () => {
    test("returns strings unchanged when their display width fits", () => {
      const input = "\u200BSisyphus"
      expect(Bun.stringWidth(input)).toBe(8)
      expect(truncateMiddle(input, 8)).toBe(input)
    })

    test("truncates invisible-prefixed strings in the middle", () => {
      const result = truncateMiddle("\u200BSisyphus: Ultraworker helps you", 15)
      expect(result).toBe("\u200BSisyphu…lps you")
      expect(Bun.stringWidth(result)).toBe(15)
    })

    test("preserves default max length", () => {
      const result = truncateMiddle("a".repeat(50))
      expect(result).toBe(`${"a".repeat(17)}…${"a".repeat(17)}`)
      expect(Bun.stringWidth(result)).toBe(35)
    })
  })

  test("does not split wide graphemes while truncating", () => {
    const family = "👨‍👩‍👧‍👦"
    const cjk = "中文"
    const right = truncate(`${family}${cjk}abc`, 7)
    const left = truncateLeft(`abc${cjk}${family}`, 7)
    const middle = truncateMiddle(`${family}${cjk}abcdef`, 8)

    expect(right).toBe(`${family}${cjk}…`)
    expect(left).toBe(`…${cjk}${family}`)
    expect(middle).toBe(`${family}中…def`)
    expect(Bun.stringWidth(right)).toBeLessThanOrEqual(7)
    expect(Bun.stringWidth(left)).toBeLessThanOrEqual(7)
    expect(Bun.stringWidth(middle)).toBeLessThanOrEqual(8)
  })
})
