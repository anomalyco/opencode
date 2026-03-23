import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { overlayColor } from "../../../src/cli/cmd/tui/ui/overlay"

const ints = (color: RGBA) => ({
  r: Math.round(color.r * 255),
  g: Math.round(color.g * 255),
  b: Math.round(color.b * 255),
  a: Math.round(color.a * 255),
})

test("uses backgroundMenu color for overlays when available", () => {
  const color = overlayColor({
    background: RGBA.fromInts(255, 255, 255),
    backgroundPanel: RGBA.fromInts(240, 240, 240),
    backgroundMenu: RGBA.fromInts(230, 220, 210),
  })

  expect(ints(color)).toEqual({
    r: 230,
    g: 220,
    b: 210,
    a: 150,
  })
})

test("falls back to backgroundPanel when backgroundMenu is transparent", () => {
  const color = overlayColor({
    background: RGBA.fromInts(255, 255, 255),
    backgroundPanel: RGBA.fromInts(235, 235, 235),
    backgroundMenu: RGBA.fromInts(0, 0, 0, 0),
  })

  expect(ints(color)).toEqual({
    r: 235,
    g: 235,
    b: 235,
    a: 150,
  })
})

test("supports custom overlay opacity", () => {
  const color = overlayColor(
    {
      background: RGBA.fromInts(255, 255, 255),
      backgroundPanel: RGBA.fromInts(235, 235, 235),
      backgroundMenu: RGBA.fromInts(230, 220, 210),
    },
    70 / 255,
  )

  expect(ints(color).a).toBe(70)
})
