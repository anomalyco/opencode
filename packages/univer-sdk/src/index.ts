/** Pulls in `interface FUniver` augmentation (sheets API: `getActiveWorkbook`, etc.). */
import "@univerjs/sheets/facade"
import type { CellValue, Univer } from "@univerjs/core"
import { FUniver } from "@univerjs/core/facade"
import type { FRange, FWorkbook, FWorksheet } from "@univerjs/sheets/facade"

/**
 * `FUniver` from `@univerjs/core` + sheets facade, plus host wiring (import/load) that presets / import plugins add at runtime.
 */
export type UniverHostApi = FUniver & {
  importXLSXToUnitIdAsync(file: File): Promise<string | undefined>
  loadServerUnit(unitId: string, unitType: number): void | Promise<unknown>
}

export type RangeRect = {
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
}

export type SheetMeta = {
  id: string
  name: string
}

export type ActiveDocument = {
  unitId: string
  sheetId: string
  sheetName: string
}

export type ExtractTableInput = {
  sheetId?: string
  range: RangeRect
  withHeaders?: boolean
}

/** What `getSheetRange` / `extractTable` read from the live sheet (includes rich text cells). */
export type SheetCellMatrix = ReturnType<FRange["getValues"]>

/**
 * Matrix write for `setRangeValues`. (Object-matrix / `ICellData` shapes are supported by Univer via `executeCommand` directly.)
 */
export type SetRangeValuesInput = {
  sheetId?: string
  range: RangeRect
  values: CellValue[][]
}

export type AddChartInput = {
  sheetId?: string
  range: RangeRect
  type?: number
  anchor?: { row: number; column: number }
}

/** Mutation payload aligned with `sheet.mutation.insert-chart`. */
type InsertChartMutationParams = {
  unitId: string
  subUnitId: string
  chartId: string
  chartType: number
  isRowDirection: boolean
  trigger: string
  range: {
    startRow: number
    endRow: number
    startColumn: number
    endColumn: number
    startAbsoluteRefType: number
    endAbsoluteRefType: number
    rangeType: number
  }
  sourceRange: {
    startRow: number
    endRow: number
    startColumn: number
    endColumn: number
  }
  anchor: { row: number; column: number }
}

type SheetRef = {
  getSheetId(): string
  getName(): string
  getRange(r1: number, c1: number, r2: number, c2: number): {
    getValues(): SheetCellMatrix
    setValues(v: CellValue[][]): void
    addChart?: (params: InsertChartMutationParams) => Promise<boolean> | boolean
  }
  addChart?: (params: InsertChartMutationParams) => Promise<boolean> | boolean
}

type WorkbookRef = {
  getUnitId(): string
  getActiveSheet(): SheetRef | null
  getSheets(): SheetRef[]
  getSheetBySheetId(id: string): SheetRef | null
  addChart?: (params: InsertChartMutationParams) => Promise<boolean> | boolean
}

class SdkError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = "UniverSdkError"
  }
}

function normalizeSheetFromFacade(fws: FWorksheet): SheetRef {
  return {
    getSheetId: () => fws.getSheetId(),
    getName: () => fws.getSheetName(),
    getRange: (r1, c1, r2, c2) => {
      const numRows = r2 - r1 + 1
      const numColumns = c2 - c1 + 1
      const r = fws.getRange(r1, c1, numRows, numColumns)
      return {
        getValues: () => r.getValues(),
        setValues: (v: CellValue[][]) => {
          r.setValues(v)
        },
      }
    },
  }
}

function normalizeWorkbookFromFacade(fwb: FWorkbook): WorkbookRef {
  return {
    getUnitId: () => fwb.getId(),
    getActiveSheet: () => {
      const s = fwb.getActiveSheet()
      return s ? normalizeSheetFromFacade(s) : null
    },
    getSheets: () => fwb.getSheets().map((s) => normalizeSheetFromFacade(s)),
    getSheetBySheetId: (id: string) => {
      const s = fwb.getSheetBySheetId(id)
      return s ? normalizeSheetFromFacade(s) : null
    },
  }
}

export type UniverSdkRuntime = { univerAPI: UniverHostApi; univer?: Univer }

function resolveWorkbook(input: UniverSdkRuntime): WorkbookRef | null {
  const primary = input.univerAPI.getActiveWorkbook()
  if (primary) return normalizeWorkbookFromFacade(primary)

  if (input.univer) {
    const api = FUniver.newAPI(input.univer)
    const wb = api.getActiveWorkbook()
    if (wb) return normalizeWorkbookFromFacade(wb)
  }

  return null
}

function mustWorkbook(input: UniverSdkRuntime): WorkbookRef {
  const wb = resolveWorkbook(input)
  if (wb) return wb
  throw new SdkError("No active workbook in Univer runtime")
}

function mustSheet(input: UniverSdkRuntime, sheetId?: string): SheetRef {
  const wb = mustWorkbook(input)
  if (!sheetId) {
    const sh = wb.getActiveSheet()
    if (sh) return sh
    throw new SdkError("No active sheet in workbook")
  }
  const sh = wb.getSheetBySheetId(sheetId)
  if (sh) return sh
  throw new SdkError(`Sheet not found: ${sheetId}`)
}

function mustRect(range: RangeRect) {
  if (range.startRow < 0 || range.startColumn < 0) throw new SdkError("Range start must be >= 0")
  if (range.endRow < range.startRow || range.endColumn < range.startColumn) {
    throw new SdkError("Range end must be >= range start")
  }
}

function normalizeRows(rows: SheetCellMatrix, withHeaders: boolean) {
  if (!withHeaders || rows.length === 0) {
    return { headers: undefined as string[] | undefined, rows }
  }
  const first = rows[0]
  if (!first) {
    return { headers: undefined as string[] | undefined, rows: [] as SheetCellMatrix }
  }
  return {
    headers: first.map((x) => String(x ?? "")),
    rows: rows.slice(1),
  }
}

function methodNames(obj: object): string[] {
  const own = Object.getOwnPropertyNames(obj)
  const proto = Object.getPrototypeOf(obj)
  const p = proto ? Object.getOwnPropertyNames(proto) : []
  return [...new Set([...own, ...p])].filter((k) => {
    if (k === "constructor") return false
    return typeof Reflect.get(obj, k) === "function"
  })
}

function randomChartId() {
  return `sdk-${Math.random().toString(36).slice(2, 12)}`
}

async function addChartViaFacade(input: {
  runtime: UniverSdkRuntime
  chartParams: InsertChartMutationParams
  sheet: SheetRef
  wb: WorkbookRef
  rangeObj: { addChart?: (params: InsertChartMutationParams) => Promise<boolean> | boolean }
}) {
  const ok = await input.runtime.univerAPI.executeCommand("sheet.mutation.insert-chart", input.chartParams)
  if (ok) return true
  if (input.rangeObj.addChart) return await input.rangeObj.addChart(input.chartParams)
  if (input.sheet.addChart) return await input.sheet.addChart(input.chartParams)
  if (input.wb.addChart) return await input.wb.addChart(input.chartParams)
  throw new SdkError("Facade chart API is unavailable in this Univer runtime")
}

export function createUniverSdk(input: UniverSdkRuntime) {
  const api = input.univerAPI
  const runtime: UniverSdkRuntime = { univerAPI: api, univer: input.univer }
  return {
    importXlsxToUnit(file: File) {
      return api.importXLSXToUnitIdAsync(file)
    },
    loadServerUnit(unitId: string, unitType: number) {
      api.loadServerUnit(unitId, unitType)
    },
    toggleDarkMode(on: boolean) {
      api.toggleDarkMode(on)
    },
    getActiveDocument(): ActiveDocument {
      const wb = mustWorkbook(runtime)
      const sh = wb.getActiveSheet()
      if (!sh) throw new SdkError("No active sheet in workbook")
      return {
        unitId: wb.getUnitId(),
        sheetId: sh.getSheetId(),
        sheetName: sh.getName(),
      }
    },
    listSheets(): SheetMeta[] {
      const wb = mustWorkbook(runtime)
      return wb.getSheets().map((x) => ({ id: x.getSheetId(), name: x.getName() }))
    },
    getSheetRange(input: { sheetId?: string; range: RangeRect }): SheetCellMatrix {
      mustRect(input.range)
      const sh = mustSheet(runtime, input.sheetId)
      return sh
        .getRange(input.range.startRow, input.range.startColumn, input.range.endRow, input.range.endColumn)
        .getValues()
    },
    extractTable(input: ExtractTableInput): { headers?: string[]; rows: SheetCellMatrix } {
      const rows = this.getSheetRange({ sheetId: input.sheetId, range: input.range })
      return normalizeRows(rows, input.withHeaders !== false)
    },
    setRangeValues(input: SetRangeValuesInput) {
      mustRect(input.range)
      if (input.values.length === 0) throw new SdkError("values must include at least one row")
      const wb = mustWorkbook(runtime)
      const sh = mustSheet(runtime, input.sheetId)
      const cellValue: Record<string, Record<string, { v: CellValue }>> = {}
      for (let r = 0; r < input.values.length; r++) {
        const rowMap: Record<string, { v: CellValue }> = {}
        const row = input.values[r] ?? []
        for (let c = 0; c < row.length; c++) {
          rowMap[String(input.range.startColumn + c)] = { v: row[c] }
        }
        cellValue[String(input.range.startRow + r)] = rowMap
      }
      api.executeCommand("sheet.mutation.set-range-values", {
        unitId: wb.getUnitId(),
        subUnitId: sh.getSheetId(),
        range: {
          startRow: input.range.startRow,
          endRow: input.range.endRow,
          startColumn: input.range.startColumn,
          endColumn: input.range.endColumn,
        },
        cellValue,
      })
    },
    async addChart(input: AddChartInput) {
      mustRect(input.range)
      const wb = mustWorkbook(runtime)
      const sh = mustSheet(runtime, input.sheetId)
      const chartParams: InsertChartMutationParams = {
        unitId: wb.getUnitId(),
        subUnitId: sh.getSheetId(),
        chartId: randomChartId(),
        chartType: input.type ?? 4,
        isRowDirection: true,
        trigger: "sheet.command.insert-sheet-image",
        range: {
          startRow: input.range.startRow,
          endRow: input.range.endRow,
          startColumn: input.range.startColumn,
          endColumn: input.range.endColumn,
          startAbsoluteRefType: 0,
          endAbsoluteRefType: 0,
          rangeType: 0,
        },
        sourceRange: {
          startRow: input.range.startRow,
          endRow: input.range.endRow,
          startColumn: input.range.startColumn,
          endColumn: input.range.endColumn,
        },
        anchor: input.anchor ?? { row: input.range.endRow + 1, column: input.range.endColumn + 1 },
      }
      const rangeObj = sh.getRange(input.range.startRow, input.range.startColumn, input.range.endRow, input.range.endColumn)
      const ok = await addChartViaFacade({ runtime, chartParams, sheet: sh, wb, rangeObj })
      if (ok) return true
      throw new SdkError("Facade chart call was rejected by Univer runtime")
    },
    inspectFacadeCapabilities(input?: { sheetId?: string; range?: RangeRect }) {
      const wb = mustWorkbook(runtime)
      const sh = mustSheet(runtime, input?.sheetId)
      const range = input?.range ?? { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }
      const rangeObj = sh.getRange(range.startRow, range.startColumn, range.endRow, range.endColumn)
      return {
        apiMethods: methodNames(runtime.univerAPI),
        workbookMethods: methodNames(wb),
        sheetMethods: methodNames(sh),
        rangeMethods: methodNames(rangeObj),
      }
    },
  }
}
