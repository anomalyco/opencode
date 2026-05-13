const SET_RANGE = "sheet.mutation.set-range-values"

type CellPatch = Record<string, unknown>

function paramsOf(m: unknown): Record<string, unknown> | undefined {
  if (!m || typeof m !== "object") return undefined
  const o = m as Record<string, unknown>
  if (o.id === SET_RANGE && o.params && typeof o.params === "object") return o.params as Record<string, unknown>
  return undefined
}

function mergeCell(into: CellPatch, patch: CellPatch) {
  for (const k of Object.keys(patch)) {
    const v = patch[k]
    if (v !== undefined) into[k] = v
  }
}

function applySetRangeValues(root: Record<string, unknown>, params: Record<string, unknown>) {
  const sub = params.subUnitId
  if (typeof sub !== "string" || !sub.length) return false
  const sheets = root.sheets
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
 * Supports `sheet.mutation.set-range-values` with `{ unitId, subUnitId, cellValue }` (and optional `range`).
 */
export function applyMutationsToSnapshotJson(snap: string, mutations: unknown[], nextRev: number): string {
  const root = JSON.parse(snap) as Record<string, unknown>
  let applied = 0
  for (const m of mutations) {
    const p = paramsOf(m)
    if (!p) continue
    if (applySetRangeValues(root, p)) applied += 1
  }
  if (mutations.length > 0 && applied === 0) {
    throw new Error("no supported mutations applied")
  }
  root.rev = nextRev
  return JSON.stringify(root)
}
