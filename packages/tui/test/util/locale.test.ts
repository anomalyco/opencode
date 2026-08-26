import { describe, expect, test } from "bun:test"
import { truncate, truncateLeft, truncateMiddle } from "../../src/util/locale"

const SAMPLE = "packages/core/src/util/path.ts"

describe("util.locale", () => {
  describe("truncate helpers", () => {
    test("never return more characters than the requested width", () => {
      for (const width of [0, 1, 2, 3, 4, 5, 10, SAMPLE.length - 1]) {
        expect(truncate(SAMPLE, width).length).toBeLessThanOrEqual(width)
        expect(truncateLeft(SAMPLE, width).length).toBeLessThanOrEqual(width)
        expect(truncateMiddle(SAMPLE, width).length).toBeLessThanOrEqual(width)
      }
    })

    test("collapse to a bare ellipsis at width 1", () => {
      expect(truncate(SAMPLE, 1)).toBe("…")
      expect(truncateLeft(SAMPLE, 1)).toBe("…")
      expect(truncateMiddle(SAMPLE, 1)).toBe("…")
    })

    test("return an empty string for a non-positive width", () => {
      expect(truncate(SAMPLE, 0)).toBe("")
      expect(truncateLeft(SAMPLE, 0)).toBe("")
      expect(truncateMiddle(SAMPLE, 0)).toBe("")
    })

    test("keep both ends once there is room for them", () => {
      expect(truncateMiddle(SAMPLE, 2)).toBe("p…")
      expect(truncateMiddle(SAMPLE, 3)).toBe("p…s")
      expect(truncateLeft(SAMPLE, 3)).toBe("…ts")
      expect(truncate(SAMPLE, 3)).toBe("pa…")
    })

    test("return the input unchanged when it already fits", () => {
      expect(truncate(SAMPLE, SAMPLE.length)).toBe(SAMPLE)
      expect(truncateLeft(SAMPLE, SAMPLE.length)).toBe(SAMPLE)
      expect(truncateMiddle(SAMPLE, SAMPLE.length)).toBe(SAMPLE)
    })
  })
})
