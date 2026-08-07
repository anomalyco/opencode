import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import {
  baseDiagramCellColorKey,
  diagramCellColorKey,
  diagramColorMapsEqual,
  diagramRadialCellColorLevel,
  mappedDiagramColor,
  normalizeDiagramColorMap,
} from "./map.js"
import {
  ansiBg,
  ansiFg,
  blendColor,
  brightenColor,
  createAnsiRampTheme,
  mixRgb,
  numberedStyleKeys,
  rgba,
} from "./style.js"

describe("diagram style helpers", () => {
  test("mixes rgb values and emits truecolor ANSI", () => {
    expect(mixRgb([0, 10, 20], [10, 30, 60], 0.5)).toEqual([5, 20, 40])
    expect(ansiFg([1, 2, 3])).toBe("\x1b[38;2;1;2;3m")
    expect(ansiBg([4, 5, 6])).toBe("\x1b[48;2;4;5;6m")
  })

  test("converts rgb tuples and blends optional RGBA values", () => {
    const black = RGBA.fromInts(0, 0, 0, 255)
    const white = RGBA.fromInts(10, 20, 30, 255)

    expect(rgba([1, 2, 3]).equals(RGBA.fromInts(1, 2, 3, 255))).toBe(true)
    expect(blendColor(black, white, 0.5).equals(RGBA.fromInts(5, 10, 15, 255))).toBe(true)
    expect(blendColor(undefined, white, 0.5)?.equals(white)).toBe(true)
    expect(blendColor(undefined, undefined, 0.5)).toBeUndefined()
  })

  test("brightens colors toward white", () => {
    const color = brightenColor(RGBA.fromInts(100, 150, 200, 255), 0.5)

    expect(color?.equals(RGBA.fromInts(178, 203, 228, 255))).toBe(true)
    expect(brightenColor(undefined)).toBeUndefined()
  })

  test("creates numbered style keys and ANSI ramps", () => {
    const styles = numberedStyleKeys("requestFade", [1, 2, 3] as const)
    const theme = createAnsiRampTheme(styles, [0, 0, 0], [12, 24, 36])

    expect(styles).toEqual(["requestFade1", "requestFade2", "requestFade3"])
    expect(theme.requestFade1).toBe("\x1b[38;2;3;6;9m")
    expect(theme.requestFade2).toBe("\x1b[38;2;6;12;18m")
    expect(theme.requestFade3).toBe("\x1b[38;2;9;18;27m")
  })

  test("normalizes and resolves leveled diagram color maps", () => {
    const red = RGBA.fromInts(255, 0, 0, 255)
    const blue = RGBA.fromInts(0, 0, 255, 255)
    const colors = normalizeDiagramColorMap({
      A: red,
      B: undefined,
      [diagramCellColorKey("C", 2)]: blue,
    })

    expect(colors.size).toBe(2)
    expect(diagramCellColorKey("A", -1)).toBe("A::cell:0")
    expect(diagramCellColorKey("A", 10)).toBe("A::cell:5")
    expect(baseDiagramCellColorKey("A::cell:3")).toBe("A")
    expect(mappedDiagramColor(colors, "A")?.equals(red)).toBe(true)
    expect(mappedDiagramColor(colors, "C::cell:2")?.equals(blue)).toBe(true)
    expect(mappedDiagramColor(colors, "C::cell:4")).toBeUndefined()
    expect(diagramColorMapsEqual(colors, normalizeDiagramColorMap(new Map(colors)))).toBe(true)
  })

  test("computes radial diagram cell color levels", () => {
    const bounds = { width: 9, height: 5, centerX: 4, centerY: 2 }

    expect(diagramRadialCellColorLevel(bounds, 4, 2)).toBe(5)
    expect(diagramRadialCellColorLevel(bounds, 0, 0)).toBe(0)
    expect(diagramRadialCellColorLevel(bounds, 4, 2, true)).toBe(1)
  })
})
