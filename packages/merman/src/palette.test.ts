import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { blendColor } from "./core/color/style.js"
import { createOpenCodeDiagramPalette } from "./palette.js"

type Rgb = readonly [number, number, number]

const rgb = (value: Rgb) => RGBA.fromInts(...value)

describe("OpenCode diagram palette", () => {
  test.each([
    {
      name: "dark theme",
      text: [230, 232, 240],
      subdued: [114, 120, 138],
      secondary: [172, 176, 189],
      muted: [149, 154, 169],
    },
    {
      name: "light theme",
      text: [32, 35, 43],
      subdued: [119, 125, 138],
      secondary: [76, 80, 91],
      muted: [93, 98, 110],
    },
  ] satisfies ReadonlyArray<{
    name: string
    text: Rgb
    subdued: Rgb
    secondary: Rgb
    muted: Rgb
  }>)("derives a controlled neutral ladder for a $name", ({ text, subdued, secondary, muted }) => {
    const primary = rgb(text)
    const info = RGBA.fromInts(40, 120, 220)
    const success = RGBA.fromInts(80, 180, 120)
    const warning = RGBA.fromInts(220, 160, 80)
    const background = RGBA.fromInts(10, 20, 30)
    const palette = createOpenCodeDiagramPalette({
      text: primary,
      subdued: rgb(subdued),
      info,
      success,
      warning,
      background,
    })

    expect(palette.text).toBe(primary)
    expect(palette.primary).toBe(primary)
    expect(palette.secondary.equals(rgb(secondary))).toBe(true)
    expect(palette.muted.equals(rgb(muted))).toBe(true)
    expect(palette.warning).toBe(info)
    expect(palette.background).toBe(background)
    expect(palette.request).toBe(success)
    expect(palette.response).toBe(warning)
    expect(palette.note).toBe(primary)
    expect(palette.noteBackground.equals(blendColor(background, rgb(subdued), 0.25))).toBe(true)
  })
})
