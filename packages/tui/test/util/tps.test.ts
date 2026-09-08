import { describe, expect, test } from "bun:test"
import { calcTps, CHARS_PER_TOKEN, estimateOutputTokens, formatTps } from "../../src/util/tps"

describe("util.tps", () => {
  describe("estimateOutputTokens", () => {
    test("estimates from character count", () => {
      expect(CHARS_PER_TOKEN).toBe(4)
      expect(estimateOutputTokens(0)).toBe(0)
      expect(estimateOutputTokens(2)).toBe(0)
      expect(estimateOutputTokens(8)).toBe(2)
    })
  })

  describe("calcTps", () => {
    test("returns zero for empty input", () => {
      expect(calcTps(0, 1000)).toBe(0)
      expect(calcTps(100, 0)).toBe(0)
      expect(calcTps(-5, 1000)).toBe(0)
      expect(calcTps(100, -1)).toBe(0)
    })

    test("computes tokens per second", () => {
      expect(calcTps(150, 1000)).toBe(150)
      expect(calcTps(75, 5000)).toBe(15)
    })
  })

  describe("formatTps", () => {
    test("formats with one decimal", () => {
      expect(formatTps(15.24)).toBe("15.2 t/s")
      expect(formatTps(150)).toBe("150.0 t/s")
    })

    test("returns undefined for non-positive values", () => {
      expect(formatTps(0)).toBeUndefined()
      expect(formatTps(-1)).toBeUndefined()
      expect(formatTps(Number.NaN)).toBeUndefined()
    })
  })
})
