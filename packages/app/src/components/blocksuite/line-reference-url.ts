export type LineRefInput = {
  path: string
  start: number
  end: number
  side?: string
  endSide?: string
  label?: string
  preview?: string
  comment?: string
}

export function normLineRef(input: Pick<LineRefInput, "start" | "end" | "side" | "endSide">) {
  const start = Math.min(input.start, input.end)
  const end = Math.max(input.start, input.end)
  return { start, end, side: input.side, endSide: input.endSide }
}

export function lineReferenceUrl(input: LineRefInput) {
  const norm = normLineRef(input)
  const params = new URLSearchParams()
  params.set("start", String(norm.start))
  params.set("end", String(norm.end))
  if (norm.side) params.set("side", norm.side)
  if (norm.endSide) params.set("endSide", norm.endSide)
  return `${input.path}?${params.toString()}`
}

export function lineSideSuffix(side?: string, endSide?: string) {
  if (!side && !endSide) return ""
  if (side && endSide && side !== endSide) return ` (${side}–${endSide})`
  const value = side ?? endSide
  return value ? ` (${value})` : ""
}

export function lineSideNote(side?: string, endSide?: string) {
  if (!side && !endSide) return ""
  if (side && endSide && side !== endSide) return `(diff: ${side}–${endSide})`
  const value = side ?? endSide
  return value ? `(diff: ${value})` : ""
}

export function lineRangeLabel(start: number, end: number) {
  const a = Math.min(start, end)
  const b = Math.max(start, end)
  if (a === b) return `L${a}`
  return `L${a}–${b}`
}
