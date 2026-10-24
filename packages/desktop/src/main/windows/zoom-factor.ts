export const MIN_ZOOM_LEVEL = 0.2

export const MAX_ZOOM_LEVEL = 10

// Missing or non-numeric values fall back to 100%; numeric values are clamped to the supported
// range, so a hand-edited out-of-range value restores to the nearest bound instead of jumping to 1.
export function normalizeZoomFactor(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1
  return Math.min(Math.max(value, MIN_ZOOM_LEVEL), MAX_ZOOM_LEVEL)
}
