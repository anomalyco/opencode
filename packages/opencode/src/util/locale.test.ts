import { describe, test, expect } from "bun:test"
import { truncate, truncateMiddle } from "./locale"

describe("locale", () => {
  describe("truncate", () => {
    test("returns string unchanged if within length limit", () => {
      const result = truncate("hello", 10)
      expect(result).toBe("hello")
    })

    test("truncates with ellipsis when string exceeds length", () => {
      // "hello world" has width 11, maxWidth 8
      // Max content width: 8 - 1 = 7
      // Can fit: 'hello w' (7) + '…' (1) = 8 total
      const result = truncate("hello world", 8)
      expect(result).toBe("hello w…")
    })

    test("preserves zero-width prefix when calculating width", () => {
      const zeroWidthPrefix = "\u200b" // Zero-width space
      const text = `${zeroWidthPrefix}test`
      // Text: zero-width char (0 width) + 'test' (4 width) = 4 total width
      // Test truncate at maxWidth 3: need to fit in 3 with ellipsis
      // Available: 3 - 1 = 2 width, can fit zero-width + 2 chars 'te'
      const result = truncate(text, 3)
      expect(result).toBe(`${zeroWidthPrefix}te…`)
    })

    test("handles wide characters correctly", () => {
      const text = "你好世界" // Each Chinese char is 2 display width
      // Total display width = 8, string length = 4
      const result = truncate(text, 6)
      // At width 6, we can fit '你好' (width 4) + '世' (width 2) = 6
      // But we need to fit ellipsis which is 1 width
      // So max width for content = 5, which fits '你好' (4) + partial '世'
      // But we can only keep whole characters, so '你好' (4) + '…' (1) = 5
      expect(result).toBe("你好…")
    })

    test("preserves raw strings without stripping invisible characters", () => {
      const text = "\u200bvisible" // Zero-width space + visible text
      const result = truncate(text, 100)
      // No truncation needed, should preserve the zero-width char
      expect(result).toBe(text)
      expect(result).toContain("\u200b")
    })
  })

  describe("truncateMiddle", () => {
    test("returns string unchanged if within length limit", () => {
      const result = truncateMiddle("hello", 10)
      expect(result).toBe("hello")
    })

    test("truncates middle with ellipsis when string exceeds length", () => {
      const result = truncateMiddle("hello world", 8)
      // Max display width 8, ellipsis width 1, available 7
      // Split: ceil(7/2) = 4 for start, floor(7/2) = 3 for end
      // Start: 'hell' (4 width) + Ellipsis (1) + End: 'rld' (3) = 8 width
      expect(result).toBe("hell…rld")
    })

    test("preserves zero-width prefix when calculating width", () => {
      const zeroWidthPrefix = "\u200b" // Zero-width space
      const text = `${zeroWidthPrefix}abcdefghij` // 10 chars, 9 display width
      const result = truncateMiddle(text, 8)
      // Display width 8: keep start and end while accounting for zero-width char
      // Original has 9 display width, need to fit in 8 with ellipsis
      // This is complex but should preserve the zero-width char
      expect(result).toContain(zeroWidthPrefix)
    })

    test("handles wide characters correctly", () => {
      const text = "你好世界朋友" // 6 chars, 12 display width
      const result = truncateMiddle(text, 8)
      // Max width 8, ellipsis 1, available 7 display width
      // Start width target = ceil(7/2) = 4 → fits '你好' (4 width)
      // End width target = floor(7/2) = 3 → fits '友' (2 width, can't fit more)
      // Result: '你好' (4) + '…' (1) + '友' (2) = 7 width
      expect(result).toBe("你好…友")
    })

    test("preserves whole emoji when keeping the end of the string", () => {
      expect(truncateMiddle("abcd😀", 5)).toBe("ab…😀")
    })

    test("preserves raw strings without stripping invisible characters", () => {
      const text = "\u200babcdefghijk" // Zero-width space + 11 chars
      const result = truncateMiddle(text, 100)
      // No truncation needed, should preserve the zero-width char
      expect(result).toBe(text)
      expect(result).toContain("\u200b")
    })
  })
})
