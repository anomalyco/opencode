import { describe, expect, test } from "bun:test"
import { clampView, detailScale, FIT_VIEW, maxScale, panBy, viewBox, wheelZoomFactor, zoomAt } from "./image-zoom"

// A 1000×500 image fitted into a 1000×600 viewport at half its natural size.
const bounds = { width: 1000, height: 500, viewportWidth: 1000, viewportHeight: 600, maxScale: maxScale(0.5) }

describe("zoomAt", () => {
  test("keeps the image point under the cursor in place", () => {
    const anchor = { x: 300, y: -100 }
    const view = zoomAt(FIT_VIEW, 2, anchor, bounds)
    // The fitted point under the anchor sits at (anchor - offset) / scale in image space.
    const before = { x: (anchor.x - FIT_VIEW.x) / FIT_VIEW.scale, y: (anchor.y - FIT_VIEW.y) / FIT_VIEW.scale }

    expect(view).toEqual({ scale: 2, x: -300, y: 100 })
    expect({ x: before.x * view.scale + view.x, y: before.y * view.scale + view.y }).toEqual(anchor)
  })

  test("zooms about the center without moving it", () => {
    expect(zoomAt({ scale: 2, x: 120, y: -40 }, 4, { x: 0, y: 0 }, bounds)).toEqual({ scale: 4, x: 240, y: -80 })
  })

  test("never shrinks below fit or grows past the limit", () => {
    expect(zoomAt({ scale: 3, x: 400, y: 200 }, 0.2, { x: 100, y: 100 }, bounds)).toEqual(FIT_VIEW)
    expect(zoomAt(FIT_VIEW, 100, { x: 0, y: 0 }, bounds).scale).toBe(16)
  })

  test("pulls an anchor near the edge back so no empty space shows", () => {
    expect(zoomAt(FIT_VIEW, 2, { x: 500, y: 0 }, bounds)).toEqual({ scale: 2, x: -500, y: 0 })
    expect(zoomAt(FIT_VIEW, 1.1, { x: 500, y: 300 }, bounds)).toEqual({ scale: 1.1, x: -50, y: 0 })
  })
})

describe("panBy", () => {
  test("moves freely inside the overflow", () => {
    expect(panBy({ scale: 2, x: 0, y: 0 }, { x: 120, y: -80 }, bounds)).toEqual({ scale: 2, x: 120, y: -80 })
  })

  test("stops at each edge of the zoomed image", () => {
    // At 2x the image is 2000×1000, so it can travel 500px horizontally and 200px vertically each way.
    expect(panBy({ scale: 2, x: 450, y: 150 }, { x: 900, y: 900 }, bounds)).toEqual({ scale: 2, x: 500, y: 200 })
    expect(panBy({ scale: 2, x: 0, y: 0 }, { x: -900, y: -900 }, bounds)).toEqual({ scale: 2, x: -500, y: -200 })
  })

  test("keeps an axis that still fits centered", () => {
    expect(panBy(FIT_VIEW, { x: 40, y: 40 }, bounds)).toEqual(FIT_VIEW)
    expect(panBy({ scale: 1.1, x: 0, y: 0 }, { x: 0, y: 40 }, bounds)).toEqual({ scale: 1.1, x: 0, y: 0 })
  })
})

describe("clampView", () => {
  test("re-centers a pan that a smaller zoom or larger viewport no longer allows", () => {
    expect(clampView({ scale: 2, x: 500, y: 200 }, { ...bounds, viewportWidth: 1600, viewportHeight: 1200 })).toEqual({
      scale: 2,
      x: 200,
      y: 0,
    })
  })
})

describe("detailScale", () => {
  test("opens a downscaled image at 100%", () => {
    expect(detailScale(0.25)).toBe(4)
  })

  test("doubles an image already shown near its natural size", () => {
    expect(detailScale(1)).toBe(2)
    expect(detailScale(0.8)).toBe(2)
  })
})

describe("wheelZoomFactor", () => {
  test("zooms in for upward deltas and out for downward ones by the same ratio", () => {
    expect(wheelZoomFactor(-10)).toBeGreaterThan(1)
    expect(wheelZoomFactor(-10) * wheelZoomFactor(10)).toBeCloseTo(1)
  })

  test("bounds a coarse mouse-wheel notch", () => {
    expect(wheelZoomFactor(-400)).toBe(wheelZoomFactor(-100))
    expect(wheelZoomFactor(-400)).toBeLessThan(1.5)
  })
})

describe("viewBox", () => {
  // An 800×450 video fitted at half its natural 1600×900.
  const size = { width: 800, height: 450 }
  const natural = { width: 1600, height: 900 }

  test("shows the whole frame at fit", () => {
    expect(viewBox(FIT_VIEW, size, natural)).toBe("none")
  })

  test("shows the middle half at 2x, and more of the left once panned right", () => {
    expect(viewBox({ scale: 2, x: 0, y: 0 }, size, natural)).toBe("inset(225px 400px 225px 400px)")
    expect(viewBox({ scale: 2, x: 200, y: 0 }, size, natural)).toBe("inset(225px 600px 225px 200px)")
  })
})
