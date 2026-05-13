import type { RangeRect } from "@opencode-ai/univer-sdk"

function lettersToCol(letters: string): number {
  let n = 0
  for (let i = 0; i < letters.length; i++) {
    const c = letters.charCodeAt(i)
    const v = c >= 65 && c <= 90 ? c - 64 : c - 96
    if (v < 1 || v > 26) throw new Error(`bad column letters: ${letters}`)
    n = n * 26 + v
  }
  return n - 1
}

function parseCell(raw: string): { row: number; col: number } {
  const t = raw.replace(/\$/g, "").trim()
  const m = t.match(/^([A-Za-z]+)(\d+)$/)
  if (!m) throw new Error(`bad cell ref: ${raw}`)
  const row = Number(m[2])
  if (!Number.isFinite(row) || row < 1) throw new Error(`bad row: ${raw}`)
  return { row: row - 1, col: lettersToCol(m[1]) }
}

/** Parses `Sheet1!A1:B2` (sheet name, no `!` in name) into sheet title + inclusive `RangeRect`. */
export function parseSheetBangRange(raw: string): { sheet: string; range: RangeRect } {
  const idx = raw.lastIndexOf("!")
  if (idx <= 0) throw new Error("range string must include Sheet!")
  const sheet = raw.slice(0, idx)
  const ref = raw.slice(idx + 1).trim()
  const parts = ref.split(":")
  if (parts.length !== 2) throw new Error("range string must be A1:B2 form")
  const a = parseCell(parts[0])
  const b = parseCell(parts[1])
  return {
    sheet,
    range: {
      startRow: Math.min(a.row, b.row),
      endRow: Math.max(a.row, b.row),
      startColumn: Math.min(a.col, b.col),
      endColumn: Math.max(a.col, b.col),
    },
  }
}

export function rectsOverlap(a: RangeRect, b: RangeRect): boolean {
  if (a.endRow < b.startRow || b.endRow < a.startRow) return false
  if (a.endColumn < b.startColumn || b.endColumn < a.startColumn) return false
  return true
}
