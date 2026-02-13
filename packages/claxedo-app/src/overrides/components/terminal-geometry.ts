export type RectLike = { width: number; height: number }
export type SizeLike = { cols: number; rows: number }

const MIN_HOST_WIDTH = 48
const MIN_HOST_HEIGHT = 32
const MIN_ROWS = 2
const CELL_WIDTH = 7
const CORRUPT_COL_RATIO = 0.35

export function hostStable(rect: RectLike) {
  return rect.width >= MIN_HOST_WIDTH && rect.height >= MIN_HOST_HEIGHT
}

export function sizeSane(size: SizeLike, rect: RectLike) {
  if (size.cols < 2 || size.rows < MIN_ROWS) return false
  const expectedCols = Math.max(2, Math.floor(rect.width / CELL_WIDTH))
  const minCols = Math.max(2, Math.floor(expectedCols * CORRUPT_COL_RATIO))
  if (size.cols < minCols) return false
  return true
}

export function shouldSendResize(size: SizeLike, rect: RectLike) {
  if (!hostStable(rect)) return false
  if (!sizeSane(size, rect)) return false
  return true
}

export function shouldRecoverDesync(input: { suspect: number; now: number; last: number; threshold?: number; cooldownMs?: number }) {
  const threshold = input.threshold ?? 3
  const cooldownMs = input.cooldownMs ?? 1500
  if (input.suspect < threshold) return false
  if (input.now - input.last < cooldownMs) return false
  return true
}
