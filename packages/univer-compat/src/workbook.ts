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
  let workbook = root
  const nested = root.workbook
  if (nested && typeof nested === "object") workbook = nested as Record<string, unknown>

  let unitRev = 0
  const rr = root.rev
  if (typeof rr === "number") unitRev = rr
  if (unitRev === 0 && typeof workbook.rev === "number") unitRev = workbook.rev
  if (unitRev === 0 && rev > 0) unitRev = rev

  if (!workbook.unitID) workbook.unitID = unitID
  if (workbook.rev === undefined) workbook.rev = unitRev
  if (!workbook.creator) workbook.creator = "veritly-mock-user"
  if (!workbook.resources) workbook.resources = []
  if (!workbook.originalMeta)
    workbook.originalMeta = b64(JSON.stringify({ locale: "enUS", styles: {}, appVersion: "0.19.0" }))
  if (!workbook.blockMeta) workbook.blockMeta = buildBlockMeta(workbook)

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
  const wb = root.workbook as Record<string, unknown> | undefined
  if (wb && typeof wb === "object") wb.rev = next
  else root.rev = next
  return JSON.stringify(root)
}
