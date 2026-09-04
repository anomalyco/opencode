import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { blendColor } from "./core/color/style.js"
import { createOpenCodeDiagramPalette, resolveOpenCodeDiagramPalette } from "./palette.js"

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
    const accent = {
      soft: RGBA.fromInts(180, 100, 40),
      clear: RGBA.fromInts(240, 160, 80),
    }
    const palette = createOpenCodeDiagramPalette({
      text: primary,
      subdued: rgb(subdued),
      info,
      success,
      warning,
      background,
      accent,
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
    expect(palette.boxText).toBe(primary)
    expect(palette.boxBorder.equals(rgb(muted))).toBe(true)
    expect(palette.line.equals(rgb(subdued))).toBe(true)
    expect(palette.labelBackground.toInts()[3]).toBe(20)
    expect(palette.group).toBe(accent.soft)
    expect(palette.groupText).toBe(accent.soft)
    expect(palette.marker.equals(rgb(secondary))).toBe(true)
    expect(palette.noteBorder).toBe(accent.soft)
    expect(palette.noteText).toBe(accent.clear)
    expect(palette.noteConnector).toBe(accent.soft)
  })

  test.each([
    { mode: "dark", soft: 300, clear: 200 },
    { mode: "light", soft: 700, clear: 800 },
  ] as const)("uses the selected $mode mode even with a literal background", ({ mode, soft, clear }) => {
    const accent = {
      200: rgb([200, 100, 100]),
      300: rgb([180, 90, 90]),
      700: rgb([120, 60, 60]),
      800: rgb([100, 50, 50]),
    }
    const theme = {
      text: {
        default: rgb([230, 232, 240]),
        subdued: rgb([114, 120, 138]),
        feedback: {
          info: { default: rgb([40, 120, 220]) },
          success: { default: rgb([80, 180, 120]) },
          warning: { default: rgb([220, 160, 80]) },
        },
      },
      background: { default: rgb([250, 250, 250]) },
      categorical: [accent],
    }
    const palette = resolveOpenCodeDiagramPalette(theme, mode)

    expect(palette.group).toBe(accent[soft])
    expect(palette.noteBorder).toBe(accent[soft])
    expect(palette.noteText).toBe(accent[clear])
  })
})
