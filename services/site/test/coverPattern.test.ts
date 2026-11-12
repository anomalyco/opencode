import { describe, expect, test } from "bun:test"
import { architectPatterns } from "../src/component/site/settings"
import { coverPatternMarkup, resolvePattern } from "../src/lib/legal/cover-pattern"
import { renderPattern } from "../src/lib/legal/pattern"

describe("architect cover patterns", () => {
  test("every Settings id resolves to the grid or a pattern", () => {
    architectPatterns.forEach((id) => expect(resolvePattern(id)).toBeDefined())
  })

  test("playground params as JSON resolve, other text does not", () => {
    expect(resolvePattern(JSON.stringify({ primitive: "lines", spacing: 5 }))).toEqual({
      primitive: "lines",
      spacing: 5,
    })
    expect(resolvePattern("not a pattern")).toBeUndefined()
    expect(resolvePattern("[1,2]")).toBeUndefined()
  })

  test("the aligned grid matches the playground: 73 columns on a 2.494097mm pitch", () => {
    const params = resolvePattern("aligned-grid")
    if (!params || params === "grid") throw new Error("aligned-grid is missing")
    const result = renderPattern(params)
    expect(result.spacing).toBeCloseTo(2.494097, 6)
    expect(result.bounds.x0).toBeCloseTo(15, 6)
    expect(result.bounds.x1).toBeCloseTo(195, 6)
    expect(result.bounds.y1).toBeCloseTo(187.518, 3)
  })

  test("US Letter ends the field 16mm above its higher label", () => {
    const params = resolvePattern("aligned-grid")
    if (!params || params === "grid") throw new Error("aligned-grid is missing")
    expect(coverPatternMarkup(params, "letter")).not.toEqual(coverPatternMarkup(params, "a4"))
  })
})
