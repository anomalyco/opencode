import { describe, expect, test } from "bun:test"
import ExcelJS from "exceljs"
import { xlsxToWorkbookJson } from "../../src/xlsx-import"

describe("xlsx import merged cells", () => {
  test("does not duplicate master text across merge slave columns", async () => {
    const title = "Transactions — Q4 2025 (DIRTY — NOT CLEANED)"
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet("Q4")
    ws.mergeCells(1, 1, 1, 9)
    ws.getCell(1, 1).value = title
    const buf = new Uint8Array(await wb.xlsx.writeBuffer())
    const out = await xlsxToWorkbookJson(crypto.randomUUID(), buf)
    const sid = out.sheetOrder[0]
    const sh = out.sheets[sid] as {
      cellData: Record<string, Record<string, { v?: unknown }>>
      mergeData: { startRow: number; endRow: number; startColumn: number; endColumn: number }[]
    }
    const row0 = sh.cellData["0"]
    const cols = Object.keys(row0).sort((a, b) => +a - +b)
    expect(cols).toEqual(["0"])
    expect(row0["0"].v).toBe(title)
    expect(sh.mergeData.length).toBe(1)
    expect(sh.mergeData[0]).toEqual({
      startRow: 0,
      endRow: 0,
      startColumn: 0,
      endColumn: 8,
    })
  })

  test("stacked header merges do not overlap rows", async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet("Q4")
    ws.mergeCells(2, 1, 2, 19)
    ws.mergeCells(3, 1, 3, 19)
    ws.getCell(2, 1).value = "title"
    ws.getCell(3, 1).value = "meta"
    const buf = new Uint8Array(await wb.xlsx.writeBuffer())
    const out = await xlsxToWorkbookJson(crypto.randomUUID(), buf)
    const sid = out.sheetOrder[0]
    const sh = out.sheets[sid] as {
      mergeData: { startRow: number; endRow: number; startColumn: number; endColumn: number }[]
    }
    expect(sh.mergeData).toEqual([
      { startRow: 1, endRow: 1, startColumn: 0, endColumn: 18 },
      { startRow: 2, endRow: 2, startColumn: 0, endColumn: 18 },
    ])
  })

  test("adjacent non-merged cells stay independent", async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet("S")
    ws.getCell(1, 1).value = "a"
    ws.getCell(1, 2).value = "b"
    const buf = new Uint8Array(await wb.xlsx.writeBuffer())
    const out = await xlsxToWorkbookJson(crypto.randomUUID(), buf)
    const sid = out.sheetOrder[0]
    const sh = out.sheets[sid] as {
      cellData: Record<string, Record<string, { v?: unknown }>>
      mergeData: unknown[]
    }
    const row0 = sh.cellData["0"]
    expect(row0["0"].v).toBe("a")
    expect(row0["1"].v).toBe("b")
    expect(sh.mergeData.length).toBe(0)
  })
})
