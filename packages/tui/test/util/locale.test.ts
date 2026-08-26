import { describe, expect, test } from "bun:test"
import { truncate, truncateLeft, truncateMiddle } from "../../src/util/locale"

function hasLoneSurrogate(str: string) {
  for (const ch of str) {
    const code = ch.codePointAt(0)
    if (code !== undefined && code >= 0xd800 && code <= 0xdfff) return true
  }
  return false
}

describe("util.locale.truncate", () => {
  test("returns strings within budget unchanged", () => {
    expect(truncate("hello", 10)).toBe("hello")
    expect(truncate("hello", 5)).toBe("hello")
    expect(truncate("", 5)).toBe("")
  })

  test("matches legacy behavior for ASCII", () => {
    expect(truncate("hello world", 5)).toBe("hell…")
  })

  test("does not split emoji surrogates", () => {
    const title = "abcdefghijklmnopqrstuvwxyz0123456789🚀🚀🚀"
    const result = truncate(title, 40)
    expect(result).toBe("abcdefghijklmnopqrstuvwxyz0123456789🚀…")
    expect(hasLoneSurrogate(result)).toBe(false)
  })

  test("measures CJK characters as two columns", () => {
    const title = "一二三四五六七八九十".repeat(4)
    expect(truncate(title, 80)).toBe(title)
    expect(truncate(title, 61)).toBe("一二三四五六七八九十".repeat(3) + "…")
    expect(truncate("中文", 3)).toBe("中…")
  })
})

describe("util.locale.truncateLeft", () => {
  test("returns strings within budget unchanged", () => {
    expect(truncateLeft("hello", 5)).toBe("hello")
    expect(truncateLeft("", 5)).toBe("")
  })

  test("matches legacy behavior for ASCII", () => {
    expect(truncateLeft("hello", 3)).toBe("…lo")
  })

  test("does not split emoji surrogates", () => {
    const result = truncateLeft("ab🚀cdefgh", 8)
    expect(result).toBe("…🚀cdefgh")
    expect(hasLoneSurrogate(result)).toBe(false)
  })

  test("measures CJK characters as two columns", () => {
    const result = truncateLeft("一二三四五六七八九十", 7)
    expect(result.startsWith("…")).toBe(true)
    expect(hasLoneSurrogate(result)).toBe(false)
  })
})

describe("util.locale.truncateMiddle", () => {
  test("returns strings within budget unchanged", () => {
    expect(truncateMiddle("hello", 35)).toBe("hello")
    expect(truncateMiddle("hello")).toBe("hello")
  })

  test("matches legacy behavior for ASCII", () => {
    expect(truncateMiddle("abcdefghijklmnopqrst", 11)).toBe("abcde…pqrst")
  })

  test("does not split emoji surrogates", () => {
    const result = truncateMiddle("🚀".repeat(10), 5)
    expect(result).toBe("🚀…🚀")
    expect(hasLoneSurrogate(result)).toBe(false)
  })

  test("measures CJK characters as two columns", () => {
    const result = truncateMiddle("一二三四五六七八九十一二三四五六七八九十", 9)
    expect(result).toBe("一二…九十")
    expect(hasLoneSurrogate(result)).toBe(false)
  })
})
