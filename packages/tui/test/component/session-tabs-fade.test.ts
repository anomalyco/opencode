import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { fadeTitleColor } from "../../src/component/session-tabs"

describe("fadeTitleColor", () => {
  const fg = RGBA.fromInts(238, 238, 238)
  const bg = RGBA.fromInts(20, 20, 20)

  test("does not fade center characters on narrow tabs (length 5)", () => {
    // Length 5 tab with scrolling marquee (leading = 1)
    const colors = Array.from({ length: 5 }, (_, i) => fadeTitleColor(fg, bg, i, 5, 1))

    // Edges are faded towards background
    expect(colors[0].equals(fg)).toBe(false)
    expect(colors[1].equals(fg)).toBe(false)
    expect(colors[3].equals(fg)).toBe(false)
    expect(colors[4].equals(fg)).toBe(false)

    // Center character is 100% opaque (equal to fg)
    expect(colors[2].equals(fg)).toBe(true)
  })

  test("does not fade center characters on narrow tabs (length 7)", () => {
    // Length 7 tab with scrolling marquee (leading = 1)
    const colors = Array.from({ length: 7 }, (_, i) => fadeTitleColor(fg, bg, i, 7, 1))

    // Center character (index 3) is 100% opaque
    expect(colors[3].equals(fg)).toBe(true)

    // Outer characters are faded
    expect(colors[0].equals(fg)).toBe(false)
    expect(colors[6].equals(fg)).toBe(false)
  })

  test("preserves standard 4-cell fade on wide tabs", () => {
    const length = 12
    const colors = Array.from({ length }, (_, i) => fadeTitleColor(fg, bg, i, length, 1))

    // Indices 0..3 fade, 4..7 are fully opaque, 8..11 fade
    expect(colors[0].equals(fg)).toBe(false)
    expect(colors[3].equals(fg)).toBe(false)
    expect(colors[4].equals(fg)).toBe(true)
    expect(colors[5].equals(fg)).toBe(true)
    expect(colors[6].equals(fg)).toBe(true)
    expect(colors[7].equals(fg)).toBe(true)
    expect(colors[8].equals(fg)).toBe(false)
    expect(colors[11].equals(fg)).toBe(false)
  })
})
