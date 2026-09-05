import { describe, expect, test } from "bun:test"
import { cycleSessionMode, resolveSessionMode, sessionModeInfinite } from "./session-mode"

describe("session mode", () => {
  test("defaults to complete", () => {
    expect(resolveSessionMode(undefined)).toBe("complete")
    expect(resolveSessionMode(null)).toBe("complete")
    expect(resolveSessionMode("complete")).toBe("complete")
  })

  test("resolves infinite only for the infinite value", () => {
    expect(resolveSessionMode("infinite")).toBe("infinite")
    expect(resolveSessionMode("other")).toBe("complete")
  })

  test("cycles between complete and infinite", () => {
    expect(cycleSessionMode("complete")).toBe("infinite")
    expect(cycleSessionMode("infinite")).toBe("complete")
  })

  test("reports infinite flag", () => {
    expect(sessionModeInfinite("infinite")).toBe(true)
    expect(sessionModeInfinite("complete")).toBe(false)
    expect(sessionModeInfinite(undefined)).toBe(false)
  })
})
