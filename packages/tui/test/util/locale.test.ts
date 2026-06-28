import { describe, expect, test } from "bun:test"
import { truncateMiddle } from "../../src/util/locale"

describe("util.locale", () => {
  describe("truncateMiddle", () => {
    test("never exceeds maxLength at small widths", () => {
      expect(truncateMiddle("hello-world", 1)).toBe("…")
      expect(truncateMiddle("hello-world", 2)).toBe("h…")
    })

    test("truncates in the middle for larger widths", () => {
      expect(truncateMiddle("hello-world", 3)).toBe("h…d")
      expect(truncateMiddle("abcdefghij", 5)).toBe("ab…ij")
    })

    test("returns the string unchanged when it fits", () => {
      expect(truncateMiddle("short", 35)).toBe("short")
    })
  })
})
