export const panelGap = 8
export const panelMinWidth = 280
export const panelMinHeight = 180

export type PanelState = {
  width: number
  height: number
  columns: number[]
  rows: number[]
}

export function normalizePanelState(input: Partial<PanelState> | undefined): PanelState {
  return {
    width: typeof input?.width === "number" && Number.isFinite(input.width) ? input.width : 0,
    height: typeof input?.height === "number" && Number.isFinite(input.height) ? input.height : 0,
    columns: Array.isArray(input?.columns) ? input.columns : [],
    rows: Array.isArray(input?.rows) ? input.rows : [],
  }
}

export function normalizePanelWeights(weights: readonly number[], count: number) {
  const values = Array.from({ length: count }, (_, index) => {
    const value = weights[index]
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1
  })
  const total = values.reduce((sum, value) => sum + value, 0)
  return values.map((value) => value / total)
}

export function panelAvailableSize(size: number, count: number, gap = panelGap) {
  return Math.max(0, size - gap * Math.max(0, count - 1))
}

export function panelTrackTemplate(weights: readonly number[]) {
  return weights.map((weight) => `minmax(0, ${weight}fr)`).join(" ")
}

export function panelPixels(weights: readonly number[], available: number) {
  return weights.map((weight) => weight * available)
}

export function panelBoundary(pixels: readonly number[], index: number) {
  return pixels.slice(0, index + 1).reduce((sum, value) => sum + value, 0)
}

export function panelHandleOffset(pixels: readonly number[], index: number, gap = panelGap) {
  return panelBoundary(pixels, index) + gap * index + gap / 2
}

export function resizePanelWeights(pixels: readonly number[], index: number, boundary: number, min: number) {
  const before = pixels.slice(0, index).reduce((sum, value) => sum + value, 0)
  const pair = (pixels[index] ?? 0) + (pixels[index + 1] ?? 0)
  const effectiveMin = Math.min(Number.isFinite(min) ? Math.max(0, min) : 0, pair / 2)
  const first = Math.min(pair - effectiveMin, Math.max(effectiveMin, boundary - before))
  const next = pixels.map((value, pixelIndex) => {
    if (pixelIndex === index) return first
    if (pixelIndex === index + 1) return pair - first
    return value
  })
  const total = next.reduce((sum, value) => sum + value, 0)
  if (!Number.isFinite(total) || total <= 0) return normalizePanelWeights(next, next.length)
  return next.map((value) => value / total)
}
