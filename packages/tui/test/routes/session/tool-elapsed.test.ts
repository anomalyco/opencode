import { describe, expect, test } from "bun:test"
import { toolElapsedText } from "../../../src/routes/session/tool-elapsed"

describe("toolElapsedText", () => {
  test("freezes on the completed span", () => {
    expect(toolElapsedText(1000, 4200, 9999)).toBe("· 3.2s")
  })

  test("ticks live while running", () => {
    expect(toolElapsedText(1000, undefined, 2500)).toBe("· 1.5s")
    expect(toolElapsedText(1000, undefined, 61000)).toBe("· 1m 0s")
  })

  test("empty when the start is unknown (e.g. pending parts carry no timestamps)", () => {
    expect(toolElapsedText(undefined, undefined, 5000)).toBe("")
  })

  test("empty on clock skew or zero-length completed spans (mirrors span())", () => {
    expect(toolElapsedText(5000, 4000, 6000)).toBe("")
    expect(toolElapsedText(5000, 5000, 6000)).toBe("")
    expect(toolElapsedText(5000, undefined, 4000)).toBe("")
  })

  test("empty for non-finite inputs", () => {
    expect(toolElapsedText(NaN, undefined, 5000)).toBe("")
    expect(toolElapsedText(1000, undefined, NaN)).toBe("")
  })
})
