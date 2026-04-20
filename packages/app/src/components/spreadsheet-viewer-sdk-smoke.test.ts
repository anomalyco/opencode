import { describe, expect, test } from "bun:test"
import type { Nullable, CellValue } from "@univerjs/core"
import { createUniverSdk, type UniverHostApi } from "@opencode-ai/univer-sdk"

function mockSdk() {
  const rows: Nullable<CellValue>[][] = [
    ["name", "value"],
    ["a", 1],
    ["b", 2],
  ]

  const calls: string[] = []

  const sheet = {
    getSheetId: () => "sheet-1",
    getSheetName: () => "Sheet 1",
    getRange: (_r1: number, _c1: number, _nr: number, _nc: number) => ({
      getValues: () => rows,
      setValues: (_v: CellValue[][]) => undefined,
    }),
  }

  const wb = {
    getId: () => "unit-1",
    getActiveSheet: () => sheet,
    getSheets: () => [sheet],
    getSheetBySheetId: () => sheet,
  }

  const sdk = createUniverSdk({
    univerAPI: {
      importXLSXToUnitIdAsync: async () => "unit-1",
      loadServerUnit: async () => {
        calls.push("load")
        return null
      },
      toggleDarkMode: () => undefined,
      executeCommand: async (id: string) => {
        if (id === "sheet.mutation.insert-chart") {
          calls.push("facade.insert-chart")
          return true
        }
        if (id === "sheet.mutation.set-drawing-apply") {
          calls.push("facade.set-drawing-apply")
          return true
        }
        return false
      },
      getActiveWorkbook: () => wb,
    } as unknown as UniverHostApi,
  })
  return { sdk, calls }
}

describe("spreadsheet viewer sdk smoke", () => {
  test("open -> extract -> add chart", async () => {
    const { sdk, calls } = mockSdk()
    sdk.loadServerUnit("unit-1", 2)
    const table = sdk.extractTable({
      range: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 },
      withHeaders: true,
    })
    expect(table.headers).toEqual(["name", "value"])
    expect(table.rows.length).toBe(2)
    await sdk.addChart({
      range: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 },
    })
    expect(calls).toEqual(["load", "facade.insert-chart", "facade.set-drawing-apply"])
  })
})
