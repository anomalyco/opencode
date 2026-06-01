import type { SelectedLineRange } from "@/context/file/types"

export type LineRefInput = {
  path: string
  start: number
  end: number
  side?: string
  endSide?: string
  additionStart?: number
  additionEnd?: number
  deletionStart?: number
  deletionEnd?: number
  label?: string
  preview?: string
  comment?: string
}

export function normLineRef(input: Pick<LineRefInput, "start" | "end" | "side" | "endSide">) {
  let start = input.start
  let end = input.end
  let side = input.side
  let endSide = input.endSide
  if (start > end) {
    start = input.end
    end = input.start
    if (side && endSide && side !== endSide) {
      const prev = side
      side = endSide
      endSide = prev
    }
  }
  return { start: Math.min(start, end), end: Math.max(start, end), side, endSide }
}

export type LineRefSegment = {
  label: string
  tone?: "additions" | "deletions"
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

export function lineRangeLabel(start: number, end: number) {
  const a = Math.min(start, end)
  const b = Math.max(start, end)
  if (a === b) return `L${a}`
  return `L${a}–${b}`
}

export type LineRefTone = "additions" | "deletions" | "mixed"

export function lineRefTone(side?: string, endSide?: string): LineRefTone | undefined {
  const start = side === "additions" || side === "deletions" ? side : undefined
  const end = endSide === "additions" || endSide === "deletions" ? endSide : undefined
  if (!start && !end) return undefined
  if (start && end && start !== end) return "mixed"
  return start ?? end
}

const span = (start?: number, end?: number) => {
  if (start === undefined || end === undefined) return
  return lineRangeLabel(start, end)
}

export function lineRefSegments(input: {
  start: number
  end: number
  side?: string
  endSide?: string
  additionStart?: number
  additionEnd?: number
  deletionStart?: number
  deletionEnd?: number
}): LineRefSegment[] {
  const tone = lineRefTone(input.side, input.endSide)
  if (tone !== "mixed") {
    const label = lineRangeLabel(input.start, input.end)
    if (!tone) return [{ label }]
    return [{ label, tone }]
  }

  const parts: LineRefSegment[] = []
  const add = span(input.additionStart, input.additionEnd)
  const del = span(input.deletionStart, input.deletionEnd)
  if (add) parts.push({ label: add, tone: "additions" })
  if (del) parts.push({ label: del, tone: "deletions" })
  if (parts.length > 0) return parts

  const side = input.side === "additions" || input.side === "deletions" ? input.side : "additions"
  const endSide = input.endSide === "additions" || input.endSide === "deletions" ? input.endSide : "deletions"
  return [
    { label: lineRangeLabel(input.start, input.start), tone: side },
    { label: lineRangeLabel(input.end, input.end), tone: endSide },
  ]
}

export function lineRefSegmentsLabel(segments: LineRefSegment[]) {
  return segments.map((part) => part.label).join(" · ")
}

const side = (value?: string): value is SelectedLineRange["side"] =>
  value === "additions" || value === "deletions"

export function lineRefToSelection(input: Pick<
  LineRefInput,
  | "start"
  | "end"
  | "side"
  | "endSide"
  | "additionStart"
  | "additionEnd"
  | "deletionStart"
  | "deletionEnd"
>): SelectedLineRange {
  const range: SelectedLineRange = {
    start: input.start,
    end: input.end,
  }
  if (side(input.side)) range.side = input.side
  if (side(input.endSide)) range.endSide = input.endSide
  if (input.additionStart) range.additionStart = input.additionStart
  if (input.additionEnd) range.additionEnd = input.additionEnd
  if (input.deletionStart) range.deletionStart = input.deletionStart
  if (input.deletionEnd) range.deletionEnd = input.deletionEnd
  return range
}
