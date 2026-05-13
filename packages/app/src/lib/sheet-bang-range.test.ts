import { describe, expect, test } from "bun:test"
import { parseSheetBangRange, rectsOverlap } from "./sheet-bang-range"

describe("sheet-bang-range", () => {
  test("parseSheetBangRange", () => {
    const out = parseSheetBangRange("Sheet 1!A1:B2")
    expect(out.sheet).toBe("Sheet 1")
    expect(out.range).toEqual({
      startRow: 0,
      endRow: 1,
      startColumn: 0,
      endColumn: 1,
    })
  })

  test("rectsOverlap", () => {
    const a = { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 }
    const b = { startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 }
    expect(rectsOverlap(a, b)).toBe(true)
    const c = { startRow: 5, endRow: 6, startColumn: 0, endColumn: 1 }
    expect(rectsOverlap(a, c)).toBe(false)
  })
})
