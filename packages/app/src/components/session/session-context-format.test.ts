import { describe, expect, test } from "bun:test"
import { createSessionContextFormatter } from "./session-context-format"

// The eight fixture values the extraction (todo 9) was verified against. Expected strings are
// hand-written, never re-derived from Intl or from the formatter's own thresholds.
const fixtures = [0, 0.5, 999, 1000, 9999, 10000, 999999, 1000000]

describe("createSessionContextFormatter", () => {
  describe("cost", () => {
    const cases: [number, string][] = [
      [0, "$0.00"],
      [0.5, "$0.50"],
      [999, "$999.00"],
      [1000, "$1,000.00"],
      [9999, "$9,999.00"],
      [10000, "$10,000.00"],
      [999999, "$999,999.00"],
      [1000000, "$1,000,000.00"],
    ]

    test("covers every fixture value", () => {
      expect(cases.map(([value]) => value)).toEqual(fixtures)
    })

    test.each(cases)("cost(%p) is %p in en-US", (value, expected) => {
      expect(createSessionContextFormatter("en-US").cost(value)).toBe(expected)
    })

    test("is locale sensitive rather than hardcoded to en-US", () => {
      const formatted = createSessionContextFormatter("de-DE").cost(1000)
      // de-DE swaps the grouping and decimal separators and moves the symbol to the end.
      expect(formatted).toContain("1.000,00")
      expect(formatted).toContain("$")
      expect(formatted).not.toBe(createSessionContextFormatter("en-US").cost(1000))
    })

    test("reuses one Intl.NumberFormat across calls on the same formatter", () => {
      const formatter = createSessionContextFormatter("en-US")
      expect(formatter.cost(1000)).toBe(formatter.cost(1000))
    })
  })

  describe("tokens", () => {
    const cases: [number, string][] = [
      [0, "0"],
      [0.5, "0.5"],
      [999, "999"],
      [1000, "1.0k"],
      [9999, "10.0k"],
      [10000, "10k"],
      [999999, "1000k"],
      [1000000, "1.0M"],
    ]

    test("covers every fixture value", () => {
      expect(cases.map(([value]) => value)).toEqual(fixtures)
    })

    test.each(cases)("tokens(%p) is %p", (value, expected) => {
      expect(createSessionContextFormatter("en-US").tokens(value)).toBe(expected)
    })

    test("is not locale sensitive", () => {
      for (const value of fixtures) {
        expect(createSessionContextFormatter("de-DE").tokens(value)).toBe(
          createSessionContextFormatter("en-US").tokens(value),
        )
      }
    })
  })
})
