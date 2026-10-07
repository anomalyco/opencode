import { describe, expect, test } from "bun:test"
import { truncate, truncateLeft, truncateMiddle } from "../../src/util/locale"

const leadingMark = /^…?[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/

describe("util.locale", () => {
  describe("truncate", () => {
    test("returns the input unchanged when within the limit", () => {
      expect(truncate("สวัสดี", 10)).toBe("สวัสดี")
      expect(truncate("hello", 5)).toBe("hello")
    })

    test("keeps Thai base+mark graphemes intact", () => {
      expect(truncate("พลัง", 3)).toBe("พลัง")
      expect(truncate("กำลังทดสอบ", 5)).toBe("กำลัง…")
    })

    test("keeps emoji ZWJ clusters intact", () => {
      expect(truncate("👨‍👩‍👧‍👦abc", 3)).toBe("👨‍👩‍👧‍👦…")
    })

    test("uses display width for wide characters", () => {
      expect(truncate("こんにちは", 5)).toBe("こん…")
    })
  })

  describe("truncateLeft", () => {
    test("does not leave an orphaned combining mark at the start", () => {
      expect(truncateLeft("กำลังทดสอบ", 8)).toBe("…ลังทดสอบ")
      expect(truncateLeft("พลัง", 3)).toBe("พลัง")
      expect(truncateLeft("สวัสดีครับ", 4)).not.toMatch(leadingMark)
    })

    test("returns the input unchanged when within the limit", () => {
      expect(truncateLeft("สวัสดีครับ", 20)).toBe("สวัสดีครับ")
    })
  })

  describe("truncateMiddle", () => {
    test("does not split graphemes at either end", () => {
      expect(truncateMiddle("กำลังทดสอบไทย", 6)).toBe("กำลั…ทย")
      expect(truncateMiddle("สวัสดีครับ", 20)).toBe("สวัสดีครับ")
    })
  })
})
