import { describe, expect, test } from "bun:test"
import { readSettings, warningText, stopText } from "@/session/budget"

describe("budget settings", () => {
  test("disabled when no budget configured", () => {
    const s = readSettings(undefined)
    expect(s.usd).toBeUndefined()
    expect(s.onExceed).toBe("stop")
    expect(s.warnAt).toEqual([0.5, 0.8])
  })

  test("reads and sorts custom warn thresholds", () => {
    const s = readSettings({ budget: { usd: 10, warn_at: [0.9, 0.25] } })
    expect(s.usd).toBe(10)
    expect(s.warnAt).toEqual([0.25, 0.9])
  })

  test("ignores out-of-range or non-numeric thresholds, falls back to default", () => {
    const s = readSettings({ budget: { usd: 10, warn_at: [1.5, -1, "x"] } })
    expect(s.warnAt).toEqual([0.5, 0.8])
  })

  test("rejects non-positive / non-finite caps", () => {
    expect(readSettings({ budget: { usd: 0 } }).usd).toBeUndefined()
    expect(readSettings({ budget: { usd: -5 } }).usd).toBeUndefined()
    expect(readSettings({ budget: { usd: Number.POSITIVE_INFINITY } }).usd).toBeUndefined()
  })

  test("on_exceed defaults to stop, accepts warn", () => {
    expect(readSettings({ budget: { usd: 5 } }).onExceed).toBe("stop")
    expect(readSettings({ budget: { usd: 5, on_exceed: "warn" } }).onExceed).toBe("warn")
    expect(readSettings({ budget: { usd: 5, on_exceed: "bogus" } }).onExceed).toBe("stop")
  })
})

describe("budget messages", () => {
  test("warning text includes spend, cap, and percent", () => {
    const t = warningText(4, 5, 0.8)
    expect(t).toContain("$4.00")
    expect(t).toContain("$5.00")
    expect(t).toContain("80%")
    expect(t).toContain("<budget-warning>")
  })

  test("stop text names the cap and spend", () => {
    const t = stopText(5.01, 5)
    expect(t).toContain("$5.00")
    expect(t).toContain("$5.01")
  })
})
