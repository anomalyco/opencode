import { describe, expect, test } from "bun:test"
import { typographyFontSize, typographyLineHeight } from "./settings"

describe("typography settings", () => {
  test("clamps font size to supported values", () => {
    expect(typographyFontSize(10)).toBe(11)
    expect(typographyFontSize(16)).toBe(16)
    expect(typographyFontSize(21)).toBe(20)
    expect(typographyFontSize(undefined)).toBe(14)
  })

  test("clamps line height to supported values", () => {
    expect(typographyLineHeight(115)).toBe(120)
    expect(typographyLineHeight(180)).toBe(180)
    expect(typographyLineHeight(225)).toBe(220)
    expect(typographyLineHeight(undefined)).toBe(150)
  })
})
