import { describe, expect, test } from "bun:test"
import { createInjectionScript } from "./injection"

describe("design preview injection", () => {
  test("generates valid javascript", () => {
    expect(() => new Function(createInjectionScript())).not.toThrow()
  })

  test("normalizes windows separators inside stripPath", () => {
    expect(createInjectionScript()).toContain("f = f.replace(/\\\\/g, '/');")
  })

  test("includes sync hook for soft preview refreshes", () => {
    expect(createInjectionScript()).toContain("window.__opencode_sync = function() {")
  })
})
