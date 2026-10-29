import { describe, expect, test } from "bun:test"
import { arrayMove } from "./index"
import { clampDelta, edgeSpeed, shifts, targetIndex } from "./geometry"

// Three 32px rows with 1px gaps, and a strip of tabs of different widths with 4px gaps.
const rows = [0, 33, 66].map((start) => ({ start, size: 32 }))

const tabs = [
  { start: 0, size: 80 },
  { start: 84, size: 40 },
  { start: 128, size: 120 },
]

// The same strip right to left in a 300px container: physical left edges 220, 176 and 52, read as flow -right.
const rtl = [
  { left: 220, width: 80 },
  { left: 176, width: 40 },
  { left: 52, width: 120 },
].map((rect) => ({ start: -(rect.left + rect.width), size: rect.width }))

describe("targetIndex", () => {
  test.each([
    [0, 0, 0],
    [0, 16, 0],
    [0, 18, 1],
    [0, 51, 2],
    [2, -18, 1],
    [2, -51, 0],
    [1, -18, 0],
  ])("row %i moved %ipx lands on %i", (from, delta, to) => {
    expect(targetIndex(rows, from, delta)).toBe(to)
  })

  test("passes a slot when its leading edge crosses that slot's center, whatever the sizes", () => {
    expect(targetIndex(tabs, 0, 23)).toBe(0)
    expect(targetIndex(tabs, 0, 25)).toBe(1)
    expect(targetIndex(tabs, 0, 107)).toBe(1)
    expect(targetIndex(tabs, 0, 109)).toBe(2)
    expect(targetIndex(tabs, 2, -23)).toBe(2)
    expect(targetIndex(tabs, 2, -25)).toBe(1)
    expect(targetIndex(tabs, 2, -89)).toBe(0)
  })

  test("reads right to left strips in flow order", () => {
    expect(targetIndex(rtl, 0, 25)).toBe(1)
    expect(targetIndex(rtl, 2, -89)).toBe(0)
  })
})

describe("shifts", () => {
  test("moving down slides the rows it passes up by its own slot", () => {
    expect(shifts(rows, 0, 2)).toEqual([66, -33, -33])
  })

  test("moving up slides the rows it passes down by its own slot", () => {
    expect(shifts(rows, 2, 0)).toEqual([33, 33, -66])
  })

  test("is all zero when the item stays", () => {
    expect(shifts(tabs, 1, 1)).toEqual([0, 0, 0])
  })

  test("variable sizes land each item where the reordered strip lays it out", () => {
    // [40, 120, 80] from 0 with 4px gaps lays out at 0, 44 and 168.
    const order = [1, 2, 0]
    const moved = shifts(tabs, 0, 2)
    expect(order.map((index) => tabs[index]!.start + moved[index]!)).toEqual([0, 44, 168])
  })

  test("right to left strips shift in flow coordinates", () => {
    expect(shifts(rtl, 0, 1)).toEqual([44, -84, 0])
  })
})

describe("clampDelta", () => {
  test("keeps the dragged slot between the first and last slots", () => {
    expect(clampDelta(rows, 1, -100)).toBe(-33)
    expect(clampDelta(rows, 1, 100)).toBe(33)
    expect(clampDelta(rows, 1, 12)).toBe(12)
    expect(clampDelta(tabs, 0, 500)).toBe(168)
  })
})

describe("edgeSpeed", () => {
  test("is zero away from the edges and eases in towards them", () => {
    expect(edgeSpeed(74, 0, 148)).toBe(0)
    expect(edgeSpeed(0, 0, 148)).toBe(-900)
    expect(edgeSpeed(148, 0, 148)).toBe(900)
    expect(edgeSpeed(-20, 0, 148)).toBe(-900)
    expect(edgeSpeed(130, 0, 148)).toBeGreaterThan(0)
    expect(edgeSpeed(130, 0, 148)).toBeLessThan(edgeSpeed(140, 0, 148))
  })

  test("never scrolls a container with no room", () => {
    expect(edgeSpeed(0, 0, 0)).toBe(0)
  })
})

test("arrayMove moves one item", () => {
  expect(arrayMove(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"])
  expect(arrayMove(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"])
})
