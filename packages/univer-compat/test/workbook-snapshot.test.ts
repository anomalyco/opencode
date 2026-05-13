import { describe, expect, test } from "bun:test"
import { Store } from "../src/store"
import { defaultWorkbook } from "../src/workbook"
import { xlsxToWorkbookJson } from "../src/xlsx-import"
import * as XLSX from "xlsx"

describe("IWorkbookData-like snapshots", () => {
  test("default workbook has sheetOrder and sheets", () => {
    const id = crypto.randomUUID()
    const wb = defaultWorkbook(id, "t")
    expect(Array.isArray(wb.sheetOrder)).toBe(true)
    expect(wb.sheetOrder.length).toBe(1)
    const sid = wb.sheetOrder[0]
    expect(wb.sheets[sid]).toBeDefined()
    expect((wb.sheets[sid] as { rowCount: number }).rowCount).toBe(1000)
  })

  test("xlsx import yields workbook JSON importable by structure checks", async () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([[1, 2]])
    XLSX.utils.book_append_sheet(wb, ws, "A")
    const buf = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }))
    const uid = crypto.randomUUID()
    const m = await xlsxToWorkbookJson(uid, buf)
    expect(m.id).toBe(uid)
    expect(m.sheetOrder.length).toBeGreaterThan(0)
    const sid = m.sheetOrder[0]
    expect((m.sheets as Record<string, unknown>)[sid]).toBeDefined()
  })

  test("Store.emptySnapshotJson static bootstrap string parses", () => {
    const raw = Store.emptySnapshotJson()
    const j = JSON.parse(raw) as { sheetOrder: string[]; sheets: Record<string, unknown> }
    expect(j.sheetOrder.length).toBeGreaterThan(0)
  })
})
