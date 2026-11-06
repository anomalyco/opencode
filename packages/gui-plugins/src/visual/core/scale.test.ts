import { describe, expect, test } from "bun:test"
import { areaPath, extent, includeZero, linear, linePath, ticks } from "./scale"

describe("linear", () => {
  test("maps a domain onto a range", () => {
    const scale = linear([0, 10], [0, 100])
    expect(scale(0)).toBe(0)
    expect(scale(5)).toBe(50)
    expect(scale(10)).toBe(100)
  })

  test("centres a zero-width domain instead of dividing by zero", () => {
    const scale = linear([4, 4], [0, 100])
    expect(scale(4)).toBe(50)
  })

  test("inverts", () => {
    const scale = linear([0, 10], [0, 100])
    expect(scale.invert(25)).toBe(2.5)
  })
})

describe("extent", () => {
  test("adds air to a flat series", () => {
    const [min, max] = extent([2, 2, 2])
    expect(min).toBeLessThan(2)
    expect(max).toBeGreaterThan(2)
  })

  test("falls back for no values", () => {
    expect(extent([], [3, 7])).toEqual([3, 7])
  })
})

describe("ticks", () => {
  test("returns round values within the domain", () => {
    const values = ticks([0, 100], 5)
    expect(values[0]).toBe(0)
    expect(values).toContain(60)
    expect(values[values.length - 1]).toBeLessThanOrEqual(100)
  })

  test("never loops forever on a zero span", () => {
    expect(ticks([5, 5], 5)).toEqual([5])
  })
})

describe("paths", () => {
  test("linePath returns an empty string for no points", () => {
    expect(linePath([])).toBe("")
  })

  test("areaPath closes to the baseline", () => {
    const path = areaPath(
      [
        [0, 10],
        [10, 20],
      ],
      30,
    )

    expect(path.endsWith("Z")).toBe(true)
    expect(path).toContain("L10,30")
  })
})

test("includeZero expands the domain", () => {
  expect(includeZero([2, 8])).toEqual([0, 8])
  expect(includeZero([-4, -2])).toEqual([-4, 0])
})
