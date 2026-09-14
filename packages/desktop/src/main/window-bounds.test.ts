import { describe, expect, test } from "bun:test"
import { boundsOutsideWorkArea, clampBoundsToWorkArea } from "./window-bounds"

const workArea = { x: 0, y: 0, width: 1920, height: 1080 }

describe("window bounds clamping", () => {
  test("leaves bounds untouched when they already fit", () => {
    expect(clampBoundsToWorkArea({ x: 100, y: 100, width: 1280, height: 800 }, workArea)).toEqual({
      x: 100,
      y: 100,
      width: 1280,
      height: 800,
    })
  })

  test("shrinks a window larger than the display", () => {
    expect(clampBoundsToWorkArea({ x: 0, y: 0, width: 3000, height: 2000 }, workArea)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    })
  })

  test("pulls a window back onto the display when it hangs off an edge", () => {
    expect(clampBoundsToWorkArea({ x: 1800, y: -50, width: 1280, height: 800 }, workArea)).toEqual({
      x: 640,
      y: 0,
      width: 1280,
      height: 800,
    })
  })

  test("respects an offset work area (secondary monitor)", () => {
    const secondary = { x: 1920, y: 0, width: 1440, height: 900 }
    expect(clampBoundsToWorkArea({ x: 1900, y: 800, width: 1280, height: 800 }, secondary)).toEqual({
      x: 1920,
      y: 100,
      width: 1280,
      height: 800,
    })
  })

  test("omits x/y and only clamps size when no saved position exists", () => {
    expect(clampBoundsToWorkArea({ width: 3000, height: 2000 }, workArea)).toEqual({ width: 1920, height: 1080 })
    expect(clampBoundsToWorkArea({ width: 800, height: 600 }, workArea)).toEqual({ width: 800, height: 600 })
  })

  test("flags bounds that no longer fit, and only those", () => {
    expect(boundsOutsideWorkArea({ x: 100, y: 100, width: 1280, height: 800 }, workArea)).toBe(false)
    expect(boundsOutsideWorkArea({ x: 1800, y: 100, width: 1280, height: 800 }, workArea)).toBe(true)
    expect(boundsOutsideWorkArea({ x: 0, y: 0, width: 3000, height: 800 }, workArea)).toBe(true)
  })
})
