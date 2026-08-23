import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { blendColor, createColorRampTheme, numberedStyleKeys, rgba } from "./style.js"

describe("diagram style helpers", () => {
  test("converts rgb tuples and blends optional RGBA values", () => {
    const black = RGBA.fromInts(0, 0, 0, 255)
    const white = RGBA.fromInts(10, 20, 30, 255)

    expect(rgba([1, 2, 3]).equals(RGBA.fromInts(1, 2, 3, 255))).toBe(true)
    expect(blendColor(black, white, 0.5).equals(RGBA.fromInts(5, 10, 15, 255))).toBe(true)
    expect(blendColor(undefined, white, 0.5)?.equals(white)).toBe(true)
    expect(blendColor(undefined, undefined, 0.5)).toBeUndefined()
  })

  test("creates numbered style keys and color ramps", () => {
    const styles = numberedStyleKeys("requestFade", [1, 2, 3] as const)
    const theme = createColorRampTheme(styles, RGBA.fromInts(0, 0, 0, 255), RGBA.fromInts(12, 24, 36, 255))

    expect(styles).toEqual(["requestFade1", "requestFade2", "requestFade3"])
    expect(theme.requestFade1.equals(RGBA.fromInts(3, 6, 9, 255))).toBe(true)
    expect(theme.requestFade3.equals(RGBA.fromInts(9, 18, 27, 255))).toBe(true)
  })
})
