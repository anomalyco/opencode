export type Size = Readonly<{ width: number; height: number }>
/** A region: source pixels for a crop, cells for a rect. */
export type Region = Readonly<{ left: number; top: number; width: number; height: number }>
export type Point = Readonly<{ x: number; y: number }>

/**
 * The source shown in a stage of cells. A cell is `cellAspect` times taller than it is wide, so a square source pixel
 * covers 1 / cellAspect as many rows as columns.
 */
export type ZoomGeometry = Readonly<{ source: Size; stage: Size; cellAspect: number }>

/** Zoom 1 fits the whole source in the stage; `x` and `y` are the source pixel at the center of the view. */
export type ZoomView = Readonly<{ zoom: number; x: number; y: number }>

export type ZoomLayout = Readonly<{
  view: ZoomView
  /** Whole source pixels inside the source. */
  crop: Region
  /** Cells the crop covers in the stage, centered as a `fit="fit"` image draws it. */
  rect: Region
  /** Columns per source pixel. */
  scale: number
}>

export const MAX_ZOOM = 32

export function initialView(source: Size): ZoomView {
  return { zoom: 1, x: source.width / 2, y: source.height / 2 }
}

/**
 * Where the view lands: the zoom within 1 and MAX_ZOOM, the center moved so the crop stays inside the source, the crop
 * in whole pixels, and the cells it fills. Zooming past the fitted size first grows the image to fill the stage, then
 * crops it.
 */
export function layoutView(geometry: ZoomGeometry, view: ZoomView): ZoomLayout {
  const source = geometry.source
  const zoom = clamp(view.zoom, 1, MAX_ZOOM)
  const scale = fitScale(geometry) * zoom
  const exact = cropSize(geometry, scale)
  const x = clamp(view.x, exact.width / 2, source.width - exact.width / 2)
  const y = clamp(view.y, exact.height / 2, source.height - exact.height / 2)
  const width = clamp(Math.round(exact.width), 1, source.width)
  const height = clamp(Math.round(exact.height), 1, source.height)
  const crop = {
    left: clamp(Math.round(x - width / 2), 0, source.width - width),
    top: clamp(Math.round(y - height / 2), 0, source.height - height),
    width,
    height,
  }
  return { view: { zoom, x, y }, crop, rect: fittedRect(geometry.stage, crop, geometry.cellAspect), scale }
}

/** Multiplies the zoom, keeping the source pixel under `point` (stage cells, default its center) where it is. */
export function zoomAt(geometry: ZoomGeometry, view: ZoomView, factor: number, point?: Point): ZoomView {
  const current = layoutView(geometry, view)
  const pointer = point ?? { x: geometry.stage.width / 2, y: geometry.stage.height / 2 }
  const anchor = sourcePoint(current, pointer, geometry.source)
  const zoom = clamp(current.view.zoom * factor, 1, MAX_ZOOM)
  const scale = fitScale(geometry) * zoom
  const size = cropSize(geometry, scale)
  // The rect of the next view, before rounding, centered in the stage.
  const left = (geometry.stage.width - size.width * scale) / 2
  const top = (geometry.stage.height - (size.height * scale) / geometry.cellAspect) / 2
  const x = anchor.x - (pointer.x + 0.5 - left) / scale + size.width / 2
  const y = anchor.y - ((pointer.y + 0.5 - top) * geometry.cellAspect) / scale + size.height / 2
  return layoutView(geometry, { zoom, x, y }).view
}

/** Moves the image by whole cells, as dragging it does: a positive `dx` shows more of its left side. */
export function panBy(geometry: ZoomGeometry, view: ZoomView, dx: number, dy: number): ZoomView {
  const current = layoutView(geometry, view)
  return layoutView(geometry, {
    ...current.view,
    x: current.view.x - dx / current.scale,
    y: current.view.y - (dy * geometry.cellAspect) / current.scale,
  }).view
}

/** The zoom at which the source covers the whole stage. */
export function fillZoom(geometry: ZoomGeometry) {
  const fit = fitScale(geometry)
  const source = geometry.source
  const zoom = Math.max(
    geometry.stage.width / (source.width * fit),
    (geometry.stage.height * geometry.cellAspect) / (source.height * fit),
  )
  return clamp(zoom, 1, MAX_ZOOM)
}

/** The zoom that shows one source pixel per terminal pixel, given the pixels in a cell's width. */
export function actualZoom(geometry: ZoomGeometry, cellPixels: number) {
  return clamp(1 / cellPixels / fitScale(geometry), 1, MAX_ZOOM)
}

/** The source pixel drawn at a stage cell, clamped into the source. */
export function sourcePoint(layout: ZoomLayout, point: Point, source: Size): Point {
  const rect = layout.rect
  const crop = layout.crop
  return {
    x: clamp(crop.left + ((point.x + 0.5 - rect.left) / rect.width) * crop.width, 0, source.width),
    y: clamp(crop.top + ((point.y + 0.5 - rect.top) / rect.height) * crop.height, 0, source.height),
  }
}

/** The cells a source region of this size takes in the stage, as OpenTUI's `fit="fit"` sizes and centers it. */
export function fittedRect(stage: Size, region: Size, cellAspect: number): Region {
  if (stage.width <= 0 || stage.height <= 0 || region.width <= 0 || region.height <= 0)
    return { left: 0, top: 0, width: 0, height: 0 }
  const aspect = (region.width / region.height) * cellAspect
  const rows = Math.min(stage.width / aspect, stage.height)
  const width = Math.max(1, Math.round(aspect * rows))
  const height = Math.max(1, Math.round(rows))
  return {
    left: Math.floor((stage.width - width) / 2),
    top: Math.floor((stage.height - height) / 2),
    width,
    height,
  }
}

// Columns per source pixel at zoom 1.
function fitScale(geometry: ZoomGeometry) {
  return Math.min(
    geometry.stage.width / geometry.source.width,
    (geometry.stage.height * geometry.cellAspect) / geometry.source.height,
  )
}

// The source pixels the stage shows at a scale: all of the source until it outgrows the stage.
function cropSize(geometry: ZoomGeometry, scale: number) {
  return {
    width: Math.min(geometry.source.width, geometry.stage.width / scale),
    height: Math.min(geometry.source.height, (geometry.stage.height * geometry.cellAspect) / scale),
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
