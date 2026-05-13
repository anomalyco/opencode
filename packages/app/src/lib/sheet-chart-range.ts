import type { FUniver } from "@univerjs/core/facade"
import type { RangeRect } from "@opencode-ai/univer-sdk"

/** Active selection A1-style inclusive range, or a small default block when nothing is selected. */
export function activeSheetSelectionRange(api: FUniver): RangeRect {
  const wb = api.getActiveWorkbook?.()
  if (!wb) throw new Error("No active workbook")
  const sh = wb.getActiveSheet()
  if (!sh) throw new Error("No active sheet")
  const cell = sh.getSelection()?.getActiveRange()
  const rect = cell?.getRange()
  if (rect) {
    return {
      startRow: rect.startRow,
      endRow: rect.endRow,
      startColumn: rect.startColumn,
      endColumn: rect.endColumn,
    }
  }
  return { startRow: 0, endRow: 3, startColumn: 0, endColumn: 1 }
}
