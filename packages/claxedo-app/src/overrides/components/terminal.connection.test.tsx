import { describe, expect, test } from "bun:test"
import { restoreThenLive, sigwinchToggleSize, socketCloseIsError } from "./terminal-connection"

describe("terminal connection", () => {
  describe("restoreThenLive", () => {
    test("restore buffer precedes live messages in output", () => {
      const out = restoreThenLive("RESTORE|", ["L1|", "L2|"])
      expect(out).toBe("RESTORE|L1|L2|")
      // Verify order: restore content appears before live content
      expect(out.indexOf("RESTORE")).toBeLessThan(out.indexOf("L1"))
    })

    test("empty restore buffer passes through live messages only", () => {
      expect(restoreThenLive("", ["L1|", "L2|"])).toBe("L1|L2|")
    })

    test("empty live array returns only restore buffer", () => {
      expect(restoreThenLive("RESTORE|", [])).toBe("RESTORE|")
    })

    test("both empty produces empty string", () => {
      expect(restoreThenLive("", [])).toBe("")
    })
  })

  describe("sigwinchToggleSize", () => {
    test("returns cols-1 then cols to force SIGWINCH", () => {
      const [first, second] = sigwinchToggleSize(80, 24)
      expect(first).toEqual({ cols: 79, rows: 24 })
      expect(second).toEqual({ cols: 80, rows: 24 })
    })

    test("rows unchanged across both sizes", () => {
      const [first, second] = sigwinchToggleSize(120, 50)
      expect(first.rows).toBe(50)
      expect(second.rows).toBe(50)
    })

    test("cols at minimum (2) stays at floor", () => {
      const [first, second] = sigwinchToggleSize(2, 24)
      expect(first.cols).toBeGreaterThanOrEqual(2)
      expect(second.cols).toBe(2)
    })

    test("cols below minimum is clamped to 2", () => {
      const [first, second] = sigwinchToggleSize(1, 24)
      expect(first.cols).toBeGreaterThanOrEqual(2)
      expect(second.cols).toBeGreaterThanOrEqual(2)
    })
  })

  describe("socketCloseIsError", () => {
    test("code 1000 (normal close) is not an error", () => {
      expect(socketCloseIsError(1000)).toBe(false)
    })

    test("abnormal close codes are errors", () => {
      expect(socketCloseIsError(1006)).toBe(true)
      expect(socketCloseIsError(1011)).toBe(true)
      expect(socketCloseIsError(1001)).toBe(true)
      expect(socketCloseIsError(4000)).toBe(true)
    })
  })
})
