import * as json1 from "ot-json1"

const SET_RANGE = "sheet.mutation.set-range-values"
const SET_DRAWING = "sheet.mutation.set-drawing-apply"
const DRAWING_RESOURCE = "SHEET_DRAWING_PLUGIN"

type CellPatch = Record<string, unknown>

function workbookSurface(root: Record<string, unknown>): Record<string, unknown> {
  const w = root.workbook
  if (w && typeof w === "object") return w as Record<string, unknown>
  return root
}

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

function applySetRangeValues(wb: Record<string, unknown>, params: Record<string, unknown>) {
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

function ensureDrawingScaffold(doc: Record<string, unknown>, unitId: string, subUnitId: string) {
  let u = doc[unitId]
  if (!u || typeof u !== "object") {
    u = {}
    doc[unitId] = u
  }
  const uo = u as Record<string, unknown>
  let s = uo[subUnitId]
  if (!s || typeof s !== "object") {
    s = { data: {}, order: [] }
    uo[subUnitId] = s
  }
  const so = s as Record<string, unknown>
  if (!so.data || typeof so.data !== "object") so.data = {}
  if (!Array.isArray(so.order)) so.order = []
}

function applySetDrawingApply(wb: Record<string, unknown>, params: Record<string, unknown>) {
  const op = params.op
  if (op === undefined) return false
  const unitId = params.unitId
  const subUnitId = params.subUnitId
  if (typeof unitId !== "string" || !unitId.length) return false
  if (typeof subUnitId !== "string" || !subUnitId.length) return false
  let resources = wb.resources
  if (!Array.isArray(resources)) {
    resources = []
    wb.resources = resources
  }
  const list = resources as { name: string; data: string }[]
  let slot = list.find((r) => r.name === DRAWING_RESOURCE)
  if (!slot) {
    slot = { name: DRAWING_RESOURCE, data: "{}" }
    list.push(slot)
  }
  let doc: Record<string, unknown> = {}
  if (slot.data && slot.data.length > 0) {
    try {
      doc = JSON.parse(slot.data) as Record<string, unknown>
    } catch {
      return false
    }
  }
  ensureDrawingScaffold(doc, unitId, subUnitId)
  const applied = json1.type.apply(doc as unknown as json1.Doc, op as json1.JSONOp)
  slot.data = JSON.stringify(applied !== undefined ? applied : doc)
  return true
}

/**
 * Apply Univer-native mutations (subset) to a workbook snapshot JSON string.
 * Supports `sheet.mutation.set-range-values` and `sheet.mutation.set-drawing-apply` (drawings in `resources` / `SHEET_DRAWING_PLUGIN`).
 */
export function applyMutationsToSnapshotJson(snap: string, mutations: unknown[], nextRev: number): string {
  const root = JSON.parse(snap) as Record<string, unknown>
  const wb = workbookSurface(root)
  let applied = 0
  for (const m of mutations) {
    const row = mutationParams(m)
    if (!row) continue
    if (row.id === SET_RANGE && applySetRangeValues(wb, row.params)) applied += 1
    if (row.id === SET_DRAWING && applySetDrawingApply(wb, row.params)) applied += 1
  }
  if (mutations.length > 0 && applied === 0) {
    throw new Error("no supported mutations applied")
  }
  setRev(root, nextRev)
  return JSON.stringify(root)
}
