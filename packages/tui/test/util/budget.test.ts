import { describe, expect, test } from "bun:test"
import { budgetView, kEffTone } from "../../src/util/budget"

describe("util.budget", () => {
  describe("budgetView", () => {
    test("returns undefined when no cap is configured", () => {
      expect(budgetView(1, undefined)).toBeUndefined()
      expect(budgetView(1, 0)).toBeUndefined()
      expect(budgetView(1, -5)).toBeUndefined()
    })

    test("muted below the first warn threshold", () => {
      const v = budgetView(2, 10, [0.5, 0.8])
      expect(v).toEqual({ pct: 0.2, tone: "muted" })
    })

    test("warning between the first and last warn threshold", () => {
      expect(budgetView(5, 10, [0.5, 0.8])?.tone).toBe("warning")
      expect(budgetView(7.9, 10, [0.5, 0.8])?.tone).toBe("warning")
    })

    test("error at or above the last warn threshold", () => {
      expect(budgetView(8, 10, [0.5, 0.8])?.tone).toBe("error")
    })

    test("error at or above 100% even without a matching threshold", () => {
      const v = budgetView(12, 10, [])
      expect(v?.tone).toBe("error")
      expect(v?.pct).toBe(1.2)
    })

    test("defaults warn thresholds to [0.5, 0.8]", () => {
      expect(budgetView(4, 10)?.tone).toBe("muted")
      expect(budgetView(6, 10)?.tone).toBe("warning")
      expect(budgetView(9, 10)?.tone).toBe("error")
    })

    test("normalizes unsorted thresholds", () => {
      expect(budgetView(8.5, 10, [0.8, 0.5])?.tone).toBe("error")
    })
  })

  describe("kEffTone", () => {
    test("muted when undefined or below the stable line", () => {
      expect(kEffTone(undefined)).toBe("muted")
      expect(kEffTone(0)).toBe("muted")
      expect(kEffTone(0.99)).toBe("muted")
    })

    test("warning between stable and runaway", () => {
      expect(kEffTone(1.0)).toBe("warning")
      expect(kEffTone(1.49)).toBe("warning")
    })

    test("error at runaway growth", () => {
      expect(kEffTone(1.5)).toBe("error")
      expect(kEffTone(3)).toBe("error")
    })
  })
})
