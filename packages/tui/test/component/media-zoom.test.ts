import { describe, expect, test } from "bun:test"
import {
  actualZoom,
  fillZoom,
  fittedRect,
  initialView,
  layoutView,
  MAX_ZOOM,
  panBy,
  sourcePoint,
  zoomAt,
  type ZoomGeometry,
} from "../../src/component/media/zoom"

const geometries: ZoomGeometry[] = [
  { source: { width: 160, height: 90 }, stage: { width: 80, height: 20 }, cellAspect: 2 },
  { source: { width: 1920, height: 1080 }, stage: { width: 200, height: 50 }, cellAspect: 2.1 },
  { source: { width: 90, height: 160 }, stage: { width: 120, height: 40 }, cellAspect: 2 },
  { source: { width: 7, height: 3 }, stage: { width: 33, height: 17 }, cellAspect: 1.8 },
]

describe("media zoom", () => {
  test("fits the whole source with the cell aspect at zoom 1", () => {
    // 160x90 is 3.56 columns per row once cells are twice as tall as wide, so 20 rows take 71 columns.
    expect(layoutView(geometries[0]!, initialView(geometries[0]!.source))).toMatchObject({
      crop: { left: 0, top: 0, width: 160, height: 90 },
      rect: { left: 4, top: 0, width: 71, height: 20 },
    })
    expect(fittedRect({ width: 120, height: 40 }, { width: 90, height: 160 }, 2).height).toBe(40)
    expect(fittedRect({ width: 120, height: 40 }, { width: 90, height: 160 }, 2).width).toBe(45)
    expect(fittedRect({ width: 0, height: 40 }, { width: 90, height: 160 }, 2)).toEqual({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    })
  })

  test.each(geometries)("keeps every crop whole and inside the source (%#)", (geometry) => {
    const views = [
      initialView(geometry.source),
      { zoom: 0.1, x: -100, y: -100 },
      { zoom: 1e6, x: 1e6, y: 1e6 },
      { zoom: 3.3, x: geometry.source.width * 0.9, y: 0.3 },
      { zoom: 7.77, x: 1.5, y: geometry.source.height - 0.2 },
    ]
    for (const view of views) {
      const layout = layoutView(geometry, view)
      const crop = layout.crop
      expect(layout.view.zoom).toBeGreaterThanOrEqual(1)
      expect(layout.view.zoom).toBeLessThanOrEqual(MAX_ZOOM)
      for (const value of [crop.left, crop.top, crop.width, crop.height]) expect(Number.isInteger(value)).toBe(true)
      expect(crop.width).toBeGreaterThanOrEqual(1)
      expect(crop.height).toBeGreaterThanOrEqual(1)
      expect(crop.left).toBeGreaterThanOrEqual(0)
      expect(crop.top).toBeGreaterThanOrEqual(0)
      expect(crop.left + crop.width).toBeLessThanOrEqual(geometry.source.width)
      expect(crop.top + crop.height).toBeLessThanOrEqual(geometry.source.height)
      expect(layout.rect.left + layout.rect.width).toBeLessThanOrEqual(geometry.stage.width)
      expect(layout.rect.top + layout.rect.height).toBeLessThanOrEqual(geometry.stage.height)
      // Clamping is stable: laying out a laid-out view changes nothing.
      expect(layoutView(geometry, layout.view)).toEqual(layout)
    }
  })

  test.each(geometries)("keeps the pixel under the pointer while zooming (%#)", (geometry) => {
    // Zoomed in far enough that the image covers the stage, so the pointer never lands in the letterbox.
    const start = { ...initialView(geometry.source), zoom: fillZoom(geometry) * 2 }
    const pointers = [
      { x: Math.floor(geometry.stage.width / 2), y: Math.floor(geometry.stage.height / 2) },
      { x: Math.floor(geometry.stage.width / 3), y: Math.floor(geometry.stage.height / 4) },
      { x: Math.floor((geometry.stage.width * 2) / 3), y: Math.floor((geometry.stage.height * 3) / 4) },
    ]
    for (const pointer of pointers) {
      for (const factor of [1.25, 1.5, 0.8]) {
        const before = layoutView(geometry, start)
        const after = layoutView(geometry, zoomAt(geometry, start, factor, pointer))
        const anchor = sourcePoint(before, pointer, geometry.source)
        const moved = sourcePoint(after, pointer, geometry.source)
        // Within a source pixel of rounding, unless the crop hit an edge of the source.
        const edge =
          after.crop.left === 0 ||
          after.crop.top === 0 ||
          after.crop.left + after.crop.width === geometry.source.width ||
          after.crop.top + after.crop.height === geometry.source.height
        if (edge) continue
        expect(Math.abs(moved.x - anchor.x)).toBeLessThanOrEqual(1 + 1 / after.scale)
        expect(Math.abs(moved.y - anchor.y)).toBeLessThanOrEqual(1 + geometry.cellAspect / after.scale)
      }
    }
  })

  test("zooming in grows the image to fill the stage before cropping", () => {
    const geometry = geometries[0]!
    const view = zoomAt(geometry, initialView(geometry.source), 1.1)
    const layout = layoutView(geometry, view)
    expect(layout.rect.width).toBe(78)
    expect(layout.rect.height).toBe(20)
    expect(layout.crop.width).toBe(160)
    expect(layout.crop.height).toBeLessThan(90)
    expect(layoutView(geometry, { ...view, zoom: fillZoom(geometry) }).rect).toEqual({
      left: 0,
      top: 0,
      width: 80,
      height: 20,
    })
    // Zooming back out past 1 returns to the fitted source.
    expect(layoutView(geometry, zoomAt(geometry, view, 0.1)).crop).toEqual({ left: 0, top: 0, width: 160, height: 90 })
  })

  test("pans with drags and stops at the edges", () => {
    const geometry = geometries[1]!
    const view = { ...initialView(geometry.source), zoom: 4 }
    const center = layoutView(geometry, view).crop
    const left = layoutView(geometry, panBy(geometry, view, 10, 0)).crop
    expect(left.left).toBeLessThan(center.left)
    expect(left.top).toBe(center.top)
    const down = layoutView(geometry, panBy(geometry, view, 0, -5)).crop
    expect(down.top).toBeGreaterThan(center.top)
    const corner = layoutView(geometry, panBy(geometry, view, 1e6, 1e6)).crop
    expect(corner.left).toBe(0)
    expect(corner.top).toBe(0)
    // A fitted image cannot pan.
    expect(panBy(geometry, initialView(geometry.source), 10, 10)).toEqual(initialView(geometry.source))
  })

  test("maps the actual size from the pixels per cell", () => {
    const geometry = geometries[1]!
    // 200 columns of 10 pixels show 2000 pixels, so 1920 source pixels fit at nearly the actual size.
    const zoom = actualZoom(geometry, 10)
    expect(layoutView(geometry, { ...initialView(geometry.source), zoom }).scale).toBeCloseTo(0.1)
    expect(actualZoom(geometries[0]!, 1000)).toBe(1)
  })
})
