import { describe, expect, test } from "bun:test"
import "@univerjs/sheets/facade"
import type { Nullable, CellValue, Univer } from "@univerjs/core"
import { ICommandService } from "@univerjs/core"
import { VERITLY_LIVE_CHART, createUniverSdk, type UniverHostApi } from "./index"

function setup() {
  const cell: Nullable<CellValue>[][] = [
    ["h1", "h2"],
    [1, 2],
    [3, 4],
  ]

  const calls: Array<{ id: string; data: object }> = []

  const sheet = {
    getSheetId: () => "sheet-1",
    getSheetName: () => "Sheet 1",
    getRange: (_r1: number, _c1: number, _numRows: number, _numCols: number) => ({
      getValues: () => cell,
      setValues: (_v: CellValue[][]) => undefined,
    }),
  }

  const wb = {
    getId: () => "unit-1",
    getActiveSheet: () => sheet,
    getSheets: () => [sheet],
    getSheetBySheetId: (id: string) => (id === "sheet-1" ? sheet : null),
  }

  const api = {
    importXLSXToUnitIdAsync: async () => "unit-x",
    loadServerUnit: () => undefined,
    toggleDarkMode: () => undefined,
    executeCommand: async (id: string, _params?: object) => {
      if (id === "sheet.mutation.insert-chart") {
        calls.push({ id: "facade.insert-chart", data: _params ?? {} })
        return true
      }
      if (id === "sheet.mutation.set-drawing-apply") {
        calls.push({ id: "facade.set-drawing-apply", data: _params ?? {} })
        return true
      }
      return false
    },
    getActiveWorkbook: () => wb,
  } as unknown as UniverHostApi

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
    const out = await sdk.addChart({
      range: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 },
    })
    expect(out.chartId.startsWith("sdk-")).toBe(true)
    expect(calls.map((x) => x.id)).toEqual(["facade.insert-chart", "facade.set-drawing-apply"])
    const apply = calls.find((x) => x.id === "facade.set-drawing-apply")?.data as {
      op: [string, string, ["data", string, { i: { componentKey: string } }], unknown]
    }
    const drawWrap = apply?.op?.[2]?.[2] as { i: { componentKey: string } } | undefined
    expect(drawWrap?.i.componentKey).toBe(VERITLY_LIVE_CHART)
  })

  test("OSS: when insert-chart is not registered, applies set-drawing-apply only", async () => {
    const grid: Nullable<CellValue>[][] = [
      ["h1", "h2"],
      [1, 2],
    ]
    const calls: Array<{ id: string; data: object }> = []
    const sheet = {
      getSheetId: () => "sheet-1",
      getSheetName: () => "Sheet 1",
      getRange: (_r1: number, _c1: number, _numRows: number, _numCols: number) => ({
        getValues: () => grid,
        setValues: (_v: CellValue[][]) => undefined,
      }),
    }
    const wb = {
      getId: () => "unit-1",
      getActiveSheet: () => sheet,
      getSheets: () => [sheet],
      getSheetBySheetId: (id: string) => (id === "sheet-1" ? sheet : null),
    }
    const api = {
      importXLSXToUnitIdAsync: async () => "unit-x",
      loadServerUnit: () => undefined,
      toggleDarkMode: () => undefined,
      executeCommand: async (id: string, params?: object) => {
        if (id === "sheet.mutation.insert-chart") {
          calls.push({ id: "facade.insert-chart", data: params ?? {} })
          return true
        }
        if (id === "sheet.mutation.set-drawing-apply") {
          calls.push({ id: "facade.set-drawing-apply", data: params ?? {} })
          return true
        }
        return false
      },
      getActiveWorkbook: () => wb,
    } as unknown as UniverHostApi

    const univer = {
      __getInjector: () => ({
        get: (token: unknown) => {
          if (token !== ICommandService) throw new Error("unexpected injector get")
          return {
            hasCommand: (cmd: string) => cmd === "sheet.mutation.set-drawing-apply",
          }
        },
      }),
    }

    const sdk = createUniverSdk({ univerAPI: api, univer: univer as Univer })
    const out = await sdk.addChart({
      range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 },
    })
    expect(out.chartId.startsWith("sdk-")).toBe(true)
    expect(calls.map((x) => x.id)).toEqual(["facade.set-drawing-apply"])
    const apply = calls.find((x) => x.id === "facade.set-drawing-apply")?.data as {
      op: [string, string, ["data", string, { i: { componentKey: string } }], unknown]
    }
    const drawWrap = apply?.op?.[2]?.[2] as { i: { componentKey: string } } | undefined
    expect(drawWrap?.i.componentKey).toBe(VERITLY_LIVE_CHART)
  })
})
