import { describe, expect, test } from "bun:test"
import { createUniverSdk } from "./index"

function setup() {
  const cell = [
    ["h1", "h2"],
    [1, 2],
    [3, 4],
  ]
  const sheet = {
    getSheetId: () => "sheet-1",
    getName: () => "Sheet 1",
    getRange: () => ({
      getValues: () => cell,
      setValues: () => undefined,
      addChart: async (data: unknown) => {
        calls.push({ id: "facade.addChart", data })
        return true
      },
    }),
  }
  const wb = {
    getUnitId: () => "unit-1",
    getActiveSheet: () => sheet,
    getSheets: () => [sheet],
    getSheetBySheetId: (id: string) => (id === "sheet-1" ? sheet : null),
  }
  const calls: Array<{ id: string; data: unknown }> = []
  const api = {
    importXLSXToUnitIdAsync: async () => "unit-x",
    loadServerUnit: () => undefined,
    toggleDarkMode: () => undefined,
    getUniver: () => ({
      getActiveWorkbook: () => wb,
    }),
  }
  return { sdk: createUniverSdk({ univerAPI: api }), calls }
}

describe("univer-sdk", () => {
  test("reads active document and sheets", () => {
    const { sdk } = setup()
    expect(sdk.getActiveDocument()).toEqual({
      unitId: "unit-1",
      sheetId: "sheet-1",
      sheetName: "Sheet 1",
    })
    expect(sdk.listSheets()).toEqual([{ id: "sheet-1", name: "Sheet 1" }])
  })

  test("extracts table with headers", () => {
    const { sdk } = setup()
    const out = sdk.extractTable({
      range: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 },
      withHeaders: true,
    })
    expect(out.headers).toEqual(["h1", "h2"])
    expect(out.rows).toEqual([
      [1, 2],
      [3, 4],
    ])
  })

  test("adds chart via facade chart API", async () => {
    const { sdk, calls } = setup()
    await sdk.addChart({
      range: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 },
    })
    expect(calls[0]?.id).toBe("facade.addChart")
  })
})
