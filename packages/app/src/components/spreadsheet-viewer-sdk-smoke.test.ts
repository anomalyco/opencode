import { describe, expect, test } from "bun:test"
import { createUniverSdk } from "@opencode-ai/univer-sdk"

function mockSdk() {
  const rows = [
    ["name", "value"],
    ["a", 1],
    ["b", 2],
  ]
  const sheet = {
    getSheetId: () => "sheet-1",
    getName: () => "Sheet 1",
    getRange: () => ({
      getValues: () => rows,
      setValues: () => undefined,
      addChart: async () => {
        calls.push("facade.addChart")
        return true
      },
    }),
  }
  const wb = {
    getUnitId: () => "unit-1",
    getActiveSheet: () => sheet,
    getSheets: () => [sheet],
    getSheetBySheetId: () => sheet,
  }
  const calls: string[] = []
  const sdk = createUniverSdk({
    univerAPI: {
      importXLSXToUnitIdAsync: async () => "unit-1",
      loadServerUnit: () => calls.push("load"),
      toggleDarkMode: () => undefined,
      getUniver: () => ({
        getActiveWorkbook: () => wb,
      }),
    },
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
    expect(calls).toEqual(["load", "facade.addChart"])
  })
})
