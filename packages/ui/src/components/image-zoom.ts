/**
 * Zoom and pan math for a fitted image inside a clipping viewport.
 *
 * `scale` is relative to the fitted size, so 1 is "fit". `x` and `y` offset the image center from the viewport
 * center in screen pixels, and anchors use the same viewport-center coordinates.
 */
export type ZoomView = { scale: number; x: number; y: number }

export type ZoomBounds = {
  /** The image's fitted size, before any zoom. */
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
  maxScale: number
}

export type ZoomPoint = { x: number; y: number }

/** Upper zoom limit, relative to the image's natural pixel size. */
const MAX_NATURAL_ZOOM = 8

export const FIT_VIEW: ZoomView = { scale: 1, x: 0, y: 0 }

/** The largest fitted-relative scale, given how far the fitted image is shrunk from its natural size. */
export function maxScale(fitRatio: number) {
  return Math.max(1, MAX_NATURAL_ZOOM / fitRatio)
}

/** Scales the view while the image point under `anchor` stays where it is on screen. */
export function zoomAt(view: ZoomView, scale: number, anchor: ZoomPoint, bounds: ZoomBounds): ZoomView {
  const next = clamp(scale, 1, bounds.maxScale)
  const ratio = next / view.scale

  return clampView(
    { scale: next, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio },
    bounds,
  )
}

export function panBy(view: ZoomView, delta: ZoomPoint, bounds: ZoomBounds): ZoomView {
  return clampView({ scale: view.scale, x: view.x + delta.x, y: view.y + delta.y }, bounds)
}

/** Keeps the zoomed image covering the viewport on each axis it overflows, and centered on each axis it fits. */
export function clampView(view: ZoomView, bounds: ZoomBounds): ZoomView {
  return {
    scale: view.scale,
    x: clampAxis(view.x, bounds.width * view.scale, bounds.viewportWidth),
    y: clampAxis(view.y, bounds.height * view.scale, bounds.viewportHeight),
  }
}

/** The double-click target: 100% for a downscaled image, or twice the fitted size when 100% is barely larger. */
export function detailScale(fitRatio: number) {
  const actual = 1 / fitRatio

  return actual >= 1.5 ? actual : 2
}

/**
 * The `object-view-box` that shows `view` of media fitted at `size`, for media that must zoom inside its own box, such
 * as a video under its controls. The inset is in the media's natural pixels.
 */
export function viewBox(
  view: ZoomView,
  size: { width: number; height: number },
  natural: { width: number; height: number },
) {
  if (view.scale <= 1) return "none"

  const edge = (offset: number, fitted: number) => 0.5 - 0.5 / view.scale - offset / (view.scale * fitted)

  const inset = [
    edge(view.y, size.height) * natural.height,
    edge(-view.x, size.width) * natural.width,
    edge(-view.y, size.height) * natural.height,
    edge(view.x, size.width) * natural.width,
  ]

  return `inset(${inset.map((value) => `${Math.max(0, Math.round(value * 100) / 100)}px`).join(" ")})`
}

/** The zoom factor for one wheel event, bounded so a coarse mouse-wheel notch is a step rather than a jump. */
export function wheelZoomFactor(deltaY: number) {
  return Math.exp(-clamp(deltaY, -30, 30) / 100)
}

function clampAxis(offset: number, size: number, viewport: number) {
  const limit = Math.max(0, (size - viewport) / 2)

  // Adding zero turns -0 into 0.
  return clamp(offset, -limit, limit) + 0
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
