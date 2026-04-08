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

export type SetRangeValuesInput = {
  sheetId?: string
  range: RangeRect
  values: unknown[][]
}

export type AddChartInput = {
  sheetId?: string
  range: RangeRect
  type?: number
  anchor?: { row: number; column: number }
}

type SheetRef = {
  getSheetId(): string
  getName(): string
  getRange(r1: number, c1: number, r2: number, c2: number): {
    getValues(): unknown[][]
    setValues(v: unknown[][]): void
    addChart?: (params: unknown) => Promise<boolean> | boolean
  }
  addChart?: (params: unknown) => Promise<boolean> | boolean
}

type WorkbookRef = {
  getUnitId(): string
  getActiveSheet(): SheetRef | null
  getSheets(): SheetRef[]
  getSheetBySheetId(id: string): SheetRef | null
  addChart?: (params: unknown) => Promise<boolean> | boolean
}

type RawSheetRef = {
  getSheetId?: () => string
  getName?: () => string
  getRange?: (r1: number, c1: number, r2: number, c2: number) => { getValues(): unknown[][]; setValues(v: unknown[][]): void }
  sheetId?: string
  id?: string
  name?: string
}

type RawWorkbookRef = {
  getUnitId?: () => string
  getActiveSheet?: () => RawSheetRef | null
  getSheets?: () => RawSheetRef[]
  getSheetBySheetId?: (id: string) => RawSheetRef | null
  unitId?: string
  id?: string
  activeSheet?: RawSheetRef | null
  sheets?: RawSheetRef[]
}

type CmdRef = {
  executeCommand(id: string, data: unknown): Promise<boolean> | boolean
}

type UniverRef = {
  getActiveWorkbook(): WorkbookRef | null
  __getInjector?: () => { get(token: unknown): CmdRef }
}

type ApiRef = {
  importXLSXToUnitIdAsync(file: File): Promise<string | undefined>
  loadServerUnit(unitId: string, unitType: number): void
  toggleDarkMode(on: boolean): void
  executeCommand?: (id: string, data: unknown) => Promise<boolean> | boolean
  getUniver?(): UniverRef
  getActiveWorkbook?(): WorkbookRef | null
  __getInjector?: () => { get(token: unknown): CmdRef }
  addChart?: (params: unknown) => Promise<boolean> | boolean
}

class SdkError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = "UniverSdkError"
  }
}

function resolveWorkbook(input: { univerAPI: ApiRef; univer?: unknown }): WorkbookRef | null {
  const fromApi = input.univerAPI.getActiveWorkbook?.()
  if (fromApi) return normalizeWorkbook(fromApi as RawWorkbookRef)

  const fromGetUniver = input.univerAPI.getUniver?.()?.getActiveWorkbook?.()
  if (fromGetUniver) return normalizeWorkbook(fromGetUniver as RawWorkbookRef)

  const raw = input.univer as { getActiveWorkbook?: () => WorkbookRef | null; getUniver?: () => UniverRef } | undefined
  const fromRaw = raw?.getActiveWorkbook?.()
  if (fromRaw) return normalizeWorkbook(fromRaw as RawWorkbookRef)

  const fromRawGetUniver = raw?.getUniver?.()?.getActiveWorkbook?.()
  if (fromRawGetUniver) return normalizeWorkbook(fromRawGetUniver as RawWorkbookRef)

  return null
}

function normalizeSheet(raw: RawSheetRef): SheetRef {
  const sid = raw.getSheetId?.() ?? raw.sheetId ?? raw.id
  if (!sid) throw new SdkError("Sheet id is unavailable on Univer sheet object")
  const name = raw.getName?.() ?? raw.name ?? sid
  if (!raw.getRange) throw new SdkError("getRange is unavailable on Univer sheet object")
  return {
    getSheetId: () => sid,
    getName: () => name,
    getRange: (r1, c1, r2, c2) => raw.getRange!(r1, c1, r2, c2),
  }
}

function normalizeWorkbook(raw: RawWorkbookRef): WorkbookRef {
  const unitId = raw.getUnitId?.() ?? raw.unitId ?? raw.id
  if (!unitId) throw new SdkError("Workbook unit id is unavailable on Univer workbook object")
  return {
    getUnitId: () => unitId,
    getActiveSheet: () => {
      const sheet = raw.getActiveSheet?.() ?? raw.activeSheet ?? null
      return sheet ? normalizeSheet(sheet) : null
    },
    getSheets: () => {
      const sheets = raw.getSheets?.() ?? raw.sheets ?? []
      return sheets.map((s) => normalizeSheet(s))
    },
    getSheetBySheetId: (id: string) => {
      const viaMethod = raw.getSheetBySheetId?.(id) ?? null
      if (viaMethod) return normalizeSheet(viaMethod)
      const sheets = raw.getSheets?.() ?? raw.sheets ?? []
      const found = sheets.find((s) => (s.getSheetId?.() ?? s.sheetId ?? s.id) === id)
      return found ? normalizeSheet(found) : null
    },
  }
}

function resolveInjector(input: { univerAPI: ApiRef; univer?: unknown }): { get(token: unknown): CmdRef } | undefined {
  const fromApi = input.univerAPI.__getInjector?.()
  if (fromApi) return fromApi

  const fromGetUniver = input.univerAPI.getUniver?.().__getInjector?.()
  if (fromGetUniver) return fromGetUniver

  const raw = input.univer as { __getInjector?: () => { get(token: unknown): CmdRef }; getUniver?: () => UniverRef } | undefined
  const fromRaw = raw?.__getInjector?.()
  if (fromRaw) return fromRaw

  const fromRawGetUniver = raw?.getUniver?.().__getInjector?.()
  if (fromRawGetUniver) return fromRawGetUniver

  return undefined
}

function mustWorkbook(input: { univerAPI: ApiRef; univer?: unknown }): WorkbookRef {
  const wb = resolveWorkbook(input)
  if (wb) return wb
  throw new SdkError("No active workbook in Univer runtime")
}

function mustSheet(input: { univerAPI: ApiRef; univer?: unknown }, sheetId?: string): SheetRef {
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

function normalizeRows(rows: unknown[][], withHeaders: boolean) {
  if (!withHeaders || rows.length === 0) {
    return { headers: undefined as string[] | undefined, rows }
  }
  const first = rows[0]
  if (!first) {
    return { headers: undefined as string[] | undefined, rows: [] as unknown[][] }
  }
  return {
    headers: first.map((x) => String(x ?? "")),
    rows: rows.slice(1),
  }
}

function methodNames(obj: unknown): string[] {
  if (!obj || (typeof obj !== "object" && typeof obj !== "function")) return []
  const own = Object.getOwnPropertyNames(obj)
  const proto = Object.getPrototypeOf(obj)
  const p = proto ? Object.getOwnPropertyNames(proto) : []
  return [...new Set([...own, ...p])].filter((k) => {
    if (k === "constructor") return false
    const v = (obj as Record<string, unknown>)[k]
    return typeof v === "function"
  })
}

function randomChartId() {
  return `sdk-${Math.random().toString(36).slice(2, 12)}`
}

async function addChartViaFacade(input: { runtime: { univerAPI: ApiRef; univer?: unknown }; chartParams: unknown; sheet: SheetRef; wb: WorkbookRef; rangeObj: { addChart?: (params: unknown) => Promise<boolean> | boolean } }) {
  if (input.runtime.univerAPI.executeCommand) {
    const ok = await input.runtime.univerAPI.executeCommand("sheet.mutation.insert-chart", input.chartParams)
    if (ok) return true
  }
  if (input.rangeObj.addChart) return await input.rangeObj.addChart(input.chartParams)
  if (input.sheet.addChart) return await input.sheet.addChart(input.chartParams)
  if (input.wb.addChart) return await input.wb.addChart(input.chartParams)
  if (input.runtime.univerAPI.addChart) return await input.runtime.univerAPI.addChart(input.chartParams)
  throw new SdkError("Facade chart API is unavailable in this Univer runtime")
}

export function createUniverSdk(input: { univerAPI: ApiRef; univer?: unknown }) {
  const api = input.univerAPI
  const runtime = { univerAPI: api, univer: input.univer }
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
    getSheetRange(input: { sheetId?: string; range: RangeRect }): unknown[][] {
      mustRect(input.range)
      const sh = mustSheet(runtime, input.sheetId)
      return sh
        .getRange(input.range.startRow, input.range.startColumn, input.range.endRow, input.range.endColumn)
        .getValues()
    },
    extractTable(input: ExtractTableInput): { headers?: string[]; rows: unknown[][] } {
      const rows = this.getSheetRange({ sheetId: input.sheetId, range: input.range })
      return normalizeRows(rows, input.withHeaders !== false)
    },
    setRangeValues(input: SetRangeValuesInput) {
      mustRect(input.range)
      if (input.values.length === 0) throw new SdkError("values must include at least one row")
      const wb = mustWorkbook(runtime)
      const sh = mustSheet(runtime, input.sheetId)
      if (api.executeCommand) {
        const cellValue: Record<string, Record<string, { v: unknown }>> = {}
        for (let r = 0; r < input.values.length; r++) {
          const rowMap: Record<string, { v: unknown }> = {}
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
        return
      }
      sh.getRange(input.range.startRow, input.range.startColumn, input.range.endRow, input.range.endColumn).setValues(input.values)
    },
    async addChart(input: AddChartInput) {
      mustRect(input.range)
      const wb = mustWorkbook(runtime)
      const sh = mustSheet(runtime, input.sheetId)
      const chartParams = {
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
