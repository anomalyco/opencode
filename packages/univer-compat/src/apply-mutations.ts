import {
  applySetDrawingApplyTyped,
  commitDrawingPluginInWorkbook,
  parseSnapshotWorkbook,
  type WorkbookWire,
} from "./workbook-wire"

const SET_RANGE = "sheet.mutation.set-range-values"
const SET_DRAWING = "sheet.mutation.set-drawing-apply"

type CellPatch = Record<string, unknown>

function setRev(root: Record<string, unknown>, nextRev: number) {
  root.rev = nextRev
  const w = root.workbook
  if (w && typeof w === "object") (w as Record<string, unknown>).rev = nextRev
}

function mutationParams(m: unknown): { id: string; params: Record<string, unknown> } | undefined {
  if (!m || typeof m !== "object") return undefined
  const o = m as Record<string, unknown>
  const id = o.id
  const p = o.params
  if (typeof id !== "string" || !p || typeof p !== "object") return undefined
  return { id, params: p as Record<string, unknown> }
}

function mergeCell(into: CellPatch, patch: CellPatch) {
  for (const k of Object.keys(patch)) {
    const v = patch[k]
    if (v !== undefined) into[k] = v
  }
}

function applySetRangeValues(wb: WorkbookWire, params: Record<string, unknown>) {
  const sub = params.subUnitId
  if (typeof sub !== "string" || !sub.length) return false
  const sheets = wb.sheets
  if (!sheets || typeof sheets !== "object") return false
  const map = sheets as Record<string, Record<string, unknown>>
  const sh = map[sub]
  if (!sh || typeof sh !== "object") return false
  const raw = params.cellValue
  if (!raw || typeof raw !== "object") return false
  const cellValue = raw as Record<string, Record<string, CellPatch>>
  let cellData = sh.cellData as Record<string, Record<string, CellPatch>> | undefined
  if (!cellData || typeof cellData !== "object") {
    cellData = {}
    sh.cellData = cellData
  }
  for (const rk of Object.keys(cellValue)) {
    const rowIn = cellValue[rk]
    if (!rowIn || typeof rowIn !== "object") continue
    let rowOut = cellData[rk]
    if (!rowOut || typeof rowOut !== "object") {
      rowOut = {}
      cellData[rk] = rowOut
    }
    for (const ck of Object.keys(rowIn)) {
      const patch = rowIn[ck]
      if (!patch || typeof patch !== "object") continue
      const cur = rowOut[ck]
      if (cur && typeof cur === "object") mergeCell(cur as CellPatch, patch)
      else rowOut[ck] = { ...patch }
    }
  }
  return true
}

/**
 * Apply Univer-native mutations (subset) to a workbook snapshot JSON string.
 * One Zod parse of the workbook surface at entry; drawing blob is typed via the live compat cache.
 */
export function applyMutationsToSnapshotJson(snap: string, mutations: unknown[], nextRev: number): string {
  const { root, wb } = parseSnapshotWorkbook(snap)
  let applied = 0
  for (const m of mutations) {
    const row = mutationParams(m)
    if (!row) continue
    if (row.id === SET_RANGE && applySetRangeValues(wb, row.params)) applied += 1
    if (row.id === SET_DRAWING && applySetDrawingApplyTyped(wb, row.params)) applied += 1
  }
  if (mutations.length > 0 && applied === 0) {
    throw new Error("no supported mutations applied")
  }
  commitDrawingPluginInWorkbook(wb, "compat")
  setRev(root, nextRev)
  return JSON.stringify(root)
}

export {
  applySetDrawingApplyTyped,
  commitDrawingPluginInWorkbook,
  openCompatDrawingDoc as parseDrawingDocForMerge,
  parseDrawingResourceBlob,
  parseSnapshotWorkbook,
  parseWorkbookWire,
  serializeCompatDrawingDoc as stringifyCompatDrawingDoc,
  type CompatDrawingDoc,
  type DrawingSlot,
  type WorkbookWire,
} from "./workbook-wire"
