import { describe, expect, test } from "bun:test"
import { truncateMiddle } from "../../src/util/locale"

describe("truncateMiddle", () => {
  test("returns the input untouched when it already fits", () => {
    expect(truncateMiddle("abc", 3)).toBe("abc")
    expect(truncateMiddle("abc", 10)).toBe("abc")
  })

  test("truncates through the middle", () => {
    expect(truncateMiddle("abcdefghij", 3)).toBe("a…j")
    expect(truncateMiddle("abcdefghij", 5)).toBe("ab…ij")
    expect(truncateMiddle("abcdefghij", 9)).toBe("abcd…ghij")
  })

  test("never exceeds maxLength", () => {
    const str = "abcdefghij"
    for (let max = 1; max <= str.length; max++) {
      expect(truncateMiddle(str, max).length).toBeLessThanOrEqual(max)
    }
  })

  test("handles a maxLength too small to keep any trailing characters", () => {
    expect(truncateMiddle("abcdefghij", 1)).toBe("…")
    expect(truncateMiddle("abcdefghij", 2)).toBe("a…")
  })
})
