import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { parseThemeDocument, resolveThemeDocument } from "@opencode/theme/tui"
import opencode from "../../src/theme/assets/v2/opencode.json"
import {
  icon,
  resolveColorDepth,
  resolveIconMode,
  resolveMotion,
  to256,
  toMonochrome,
} from "../../src/ui/design"

function channels(color: RGBA) {
  return [color.r, color.g, color.b, color.a].map((value) => Math.round(value * 255))
}

describe("design capabilities", () => {
  test("keeps an explicit color depth and only auto-detects truecolor", () => {
    expect(resolveColorDepth("truecolor", {})).toBe("truecolor")
    expect(resolveColorDepth("256", { COLORTERM: "truecolor" })).toBe("256")
    expect(resolveColorDepth("auto", { TERM: "xterm-256color" })).toBe("256")
    expect(resolveColorDepth("auto", { COLORTERM: "truecolor" })).toBe("truecolor")
    expect(resolveColorDepth("auto", { TERM_PROGRAM: "WezTerm" })).toBe("truecolor")
  })

  test("assumes ASCII icons unless a Nerd Font is declared", () => {
    expect(resolveIconMode("auto", {})).toBe("ascii")
    expect(resolveIconMode("auto", { NERD_FONT: "1" })).toBe("nerd")
    expect(resolveIconMode("ascii", { NERD_FONT: "1" })).toBe("ascii")
    expect(icon("branch", "ascii")).toBe("git:")
    expect(icon("branch", "nerd")).toBe("\ue725")
  })

  test("maps reduced motion from an explicit setting or the environment", () => {
    expect(resolveMotion("auto", {})).toBe("full")
    expect(resolveMotion("auto", { OPENCODE_REDUCED_MOTION: "1" })).toBe("reduced")
    expect(resolveMotion("full", { OPENCODE_REDUCED_MOTION: "1" })).toBe("full")
  })
})

describe("color transforms", () => {
  test("quantizes truecolor to the nearest 256-color entry", () => {
    expect(channels(to256(RGBA.fromInts(255, 0, 0)))).toEqual([255, 0, 0, 255])
    expect(channels(to256(RGBA.fromInts(128, 128, 128)))).toEqual([128, 128, 128, 255])
    expect(channels(to256(RGBA.fromInts(12, 200, 90))).every((value) => value >= 0 && value <= 255)).toBe(true)
  })

  test("keeps alpha and transparency", () => {
    expect(channels(to256(RGBA.fromInts(255, 0, 0, 0)))).toEqual([255, 0, 0, 0])
    expect(channels(toMonochrome(RGBA.fromInts(255, 0, 0, 128)))).toEqual([54, 54, 54, 128])
  })

  test("applies monochrome to every resolved theme color", () => {
    const document = parseThemeDocument(opencode, "opencode")
    const theme = resolveThemeDocument(document, "dark", toMonochrome)
    const colors = [
      theme.text.base,
      theme.text.muted,
      theme.background.base,
      theme.background.raised.base,
      theme.diff.text.added,
      theme.hue.accent[500],
    ]

    for (const color of colors) {
      expect(color.r).toBe(color.g)
      expect(color.g).toBe(color.b)
    }
  })

  test("keeps the 256-color fallback on the theme path", () => {
    const document = parseThemeDocument(opencode, "opencode")
    const theme = resolveThemeDocument(document, "dark", to256)
    const color = theme.hue.accent[500]

    expect(channels(color)).toEqual(channels(to256(color)))
  })
})
