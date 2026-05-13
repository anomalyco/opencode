import { commitDrawingPluginInWorkbook } from "./drawing-plugin"
import { parseWorkbookWire } from "./parse-wire"
import { WORKBOOK_SCHEMA_VERSION } from "./schema-version/latest"
import {
  migrateWorkbookToLatest,
  stampWorkbookSchemaVersion,
  workbookBodyFromSnapshotRoot,
} from "./schema-version/run"

function b64(s: string) {
  return Buffer.from(s, "utf8").toString("base64")
}

export function defaultWorkbook(id: string, name: string) {
  const sid = crypto.randomUUID()
  const sheetMeta = b64("{}")
  const workbookMeta = b64(JSON.stringify({ locale: "enUS", styles: {}, appVersion: "0.19.0" }))
  return {
    id,
    name,
    schemaVersion: WORKBOOK_SCHEMA_VERSION,
    appVersion: "0.19.0",
    locale: "enUS",
    originalMeta: workbookMeta,
    styles: {} as Record<string, unknown>,
    sheetOrder: [sid],
    sheets: {
      [sid]: {
        id: sid,
        name: "Sheet1",
        originalMeta: sheetMeta,
        tabColor: "",
        hidden: 0,
        rowCount: 1000,
        columnCount: 26,
        defaultColumnWidth: 73,
        defaultRowHeight: 23,
        cellData: {} as Record<string, Record<string, { v?: unknown; t?: number }>>,
        rowData: {} as Record<string, unknown>,
        columnData: {} as Record<string, unknown>,
        showGridlines: 1,
        rightToLeft: 0,
      },
    },
  }
}

export function buildBlockMeta(workbook: Record<string, unknown>) {
  const meta: Record<string, Record<string, unknown>> = {}
  const order = workbook.sheetOrder as unknown[]
  if (!Array.isArray(order)) return meta
  order.forEach((raw, i) => {
    const sid = String(raw)
    meta[sid] = {
      sheetID: sid,
      blocks: [`compat-block-${i + 1}`],
    }
  })
  return meta
}

export function workbookFromSnapshot(unitID: string, rev: number, snap: string) {
  const root = JSON.parse(snap) as Record<string, unknown>
  let raw = root
  const nested = root.workbook
  if (nested && typeof nested === "object") raw = nested as Record<string, unknown>

  let unitRev = 0
  const rr = root.rev
  if (typeof rr === "number") unitRev = rr
  if (unitRev === 0 && typeof raw.rev === "number") unitRev = raw.rev
  if (unitRev === 0 && rev > 0) unitRev = rev

  if (!raw.unitID) raw.unitID = unitID
  if (raw.rev === undefined) raw.rev = unitRev
  if (!raw.creator) raw.creator = "veritly-mock-user"
  if (!raw.resources) raw.resources = []

  const workbook = parseWorkbookWire(raw)
  commitDrawingPluginInWorkbook(workbook, "univer")

  if (!workbook.originalMeta)
    workbook.originalMeta = b64(JSON.stringify({ locale: "enUS", styles: {}, appVersion: "0.19.0" }))
  if (!workbook.blockMeta) workbook.blockMeta = buildBlockMeta(workbook as Record<string, unknown>)

  const sheets = workbook.sheets as Record<string, Record<string, unknown>> | undefined
  if (sheets) {
    for (const k of Object.keys(sheets)) {
      const sh = sheets[k]
      if (!sh.originalMeta) sh.originalMeta = b64("{}")
    }
  }

  return { workbook, unitRev }
}

export function buildRealSnapshotEnvelope(unitID: string, typ: number, rev: number, snap: string) {
  const { workbook, unitRev } = workbookFromSnapshot(unitID, rev, snap)
  return {
    snapshot: {
      unitID,
      type: typ,
      rev: unitRev,
      workbook,
      doc: null,
    },
  }
}

export function bumpSnapshotRevOnly(raw: string, next: number) {
  const root = JSON.parse(raw) as Record<string, unknown>
  const body = workbookBodyFromSnapshotRoot(root)
  migrateWorkbookToLatest(body)
  stampWorkbookSchemaVersion(body)
  const wb = root.workbook as Record<string, unknown> | undefined
  if (wb && typeof wb === "object") wb.rev = next
  else body.rev = next
  return JSON.stringify(root)
}
