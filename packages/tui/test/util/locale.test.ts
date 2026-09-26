import { describe, expect, test } from "bun:test"
import { Locale } from "../../src/util/locale"

describe("locale truncation", () => {
  test.each([
    { text: "abcdef", length: 4, right: "abc…", left: "…def", middle: "ab…f" },
    { text: "abc", length: 3, right: "abc", left: "abc", middle: "abc" },
    { text: "", length: 1, right: "", left: "", middle: "" },
    { text: "abcdef", length: 2, right: "a…", left: "…f", middle: "a…" },
    { text: "abcdef", length: 1, right: "…", left: "…", middle: "…" },
    { text: "abcdef", length: 0, right: "", left: "", middle: "" },
    { text: "abcdef", length: -1, right: "", left: "", middle: "" },
    { text: "พลัง", length: 3, right: "พ…", left: "…ง", middle: "พ…ง" },
    { text: "ที่ดี", length: 4, right: "ที่…", left: "…ดี", middle: "…" },
    { text: "น้ำดี", length: 4, right: "น้ำ…", left: "…ดี", middle: "…" },
    { text: "aที่b", length: 4, right: "a…", left: "…b", middle: "a…b" },
    { text: "กผู้", length: 3, right: "ก…", left: "…", middle: "ก…" },
    { text: "e\u0301xy", length: 3, right: "e\u0301…", left: "…xy", middle: "…y" },
    { text: "中文测试", length: 3, right: "中文…", left: "…测试", middle: "中…试" },
    { text: "a👍b", length: 3, right: "a…", left: "…b", middle: "a…b" },
    { text: "a👩🏽‍💻b", length: 5, right: "a…", left: "…b", middle: "a…b" },
    { text: "a🇹🇭b", length: 4, right: "a…", left: "…b", middle: "a…b" },
  ])("preserves whole graphemes in $text with a $length-unit budget", (item) => {
    expect(Locale.truncate(item.text, item.length)).toBe(item.right)
    expect(Locale.truncateLeft(item.text, item.length)).toBe(item.left)
    expect(Locale.truncateMiddle(item.text, item.length)).toBe(item.middle)
  })

  test("keeps the default middle-truncation budget", () => {
    expect(Locale.truncateMiddle("hello")).toBe("hello")
    expect(Locale.truncateMiddle("0123456789".repeat(4))).toBe("01234567890123456…34567890123456789")
  })

  test.each(["ที่ดี", "กำลัง", "น้ำ👍ดี", "a👩🏽‍💻b", "e\u0301x🇹🇭y", "ทดสอบ中文abc"])(
    "cuts %s only at original grapheme boundaries for every budget",
    (text) => {
      const boundaries = new Set([
        ...Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.index),
        text.length,
      ])
      for (let length = 0; length <= text.length + 1; length++) {
        for (const truncate of [Locale.truncate, Locale.truncateLeft, Locale.truncateMiddle]) {
          const result = truncate(text, length)
          expect(result.length).toBeLessThanOrEqual(length)
          if (text.length <= length) {
            expect(result).toBe(text)
            continue
          }
          if (length === 0) {
            expect(result).toBe("")
            continue
          }
          const parts = result.split("…")
          expect(parts).toHaveLength(2)
          expect(text.startsWith(parts[0])).toBe(true)
          expect(text.endsWith(parts[1])).toBe(true)
          expect(boundaries.has(parts[0].length)).toBe(true)
          expect(boundaries.has(text.length - parts[1].length)).toBe(true)
        }
      }
    },
  )
})
