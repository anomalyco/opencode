import { expect, test } from "bun:test"
import { embedBounds, overlaps } from "./embed-geometry"

test("rounds physical edges separately in window DIPs after layout has resolved direction", () => {
  expect(embedBounds({ left: 120.4, right: 220.8, top: 20.4, bottom: 30.4 }, 1.25)).toEqual({
    x: 151,
    y: 26,
    width: 125,
    height: 12,
  })
})

test("only positive-area intersections cover a pane or put it on screen", () => {
  const pane = { left: 12, right: 44, top: 10, bottom: 50 }
  expect(overlaps(pane, { ...pane, left: 43 })).toBe(true)
  expect(overlaps(pane, { ...pane, left: 44, right: 99 })).toBe(false)
  expect(overlaps(pane, { ...pane, top: 22, bottom: 22 })).toBe(false)
})
