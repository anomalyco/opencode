import ExcelJS from "exceljs"
import { WORKBOOK_SCHEMA_VERSION } from "./workbook"

function b64(s: string) {
  return Buffer.from(s, "utf8").toString("base64")
}

/** Maps ExcelJS ARGB (e.g. FFFFFF or FFFFFFFF) to `#RRGGBB`. */
function argbToRgb(hex: string | undefined) {
  if (!hex || hex.length < 6) return undefined
  const h = hex.length >= 8 ? hex.slice(2) : hex
  return `#${h.slice(0, 6)}`
}

function styleFingerprint(style: Record<string, unknown>) {
  return JSON.stringify(style)
}

/** Build Univer-style cell style from ExcelJS cell (subset: fill, font weight/color/size). */
function styleFromCell(cell: ExcelJS.Cell): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  const fill = cell.fill
  if (fill && typeof fill === "object" && "fgColor" in fill) {
    const fg = (fill as { fgColor?: { argb?: string } }).fgColor
    const rgb = argbToRgb(fg?.argb)
    if (rgb) out.bg = { rgb }
  }
  const font = cell.font
  if (font && typeof font === "object") {
    if (font.bold) out.bl = 1
    if (font.italic) out.it = 1
    if (typeof font.size === "number") out.fs = Math.round(font.size)
    if (font.name) out.ff = font.name
    const rgb = argbToRgb(font.color && "argb" in font.color ? font.color.argb : undefined)
    if (rgb) out.cl = { rgb }
  }
  return Object.keys(out).length ? out : null
}

function cellPayload(cell: ExcelJS.Cell): { v: unknown; t: number; s?: string } | null {
  const v = cell.value
  if (v === null || v === undefined) return null
  if (typeof v === "number" && !Number.isNaN(v)) return { v, t: 2 }
  if (typeof v === "boolean") return { v: v ? 1 : 0, t: 4 }
  if (typeof v === "string") return { v, t: 1 }
  if (typeof v === "object" && v !== null && "text" in v) {
    const t = (v as { text?: string }).text
    return { v: t ?? "", t: 1 }
  }
  if (typeof v === "object" && v !== null && "result" in v) {
    const r = (v as { result?: unknown }).result
    if (typeof r === "number") return { v: r, t: 2 }
    if (typeof r === "boolean") return { v: r ? 1 : 0, t: 4 }
    return { v: r !== undefined && r !== null ? String(r) : "", t: 1 }
  }
  return { v: String(v), t: 1 }
}

/**
 * xlsx → Univer-style workbook JSON (`IWorkbookData`-like), using ExcelJS so fills/fonts survive import.
 */
export async function xlsxToWorkbookJson(unitID: string, buf: Uint8Array) {
  const xlsx = new ExcelJS.Workbook()
  // exceljs typings expect Node `Buffer`; Bun `Uint8Array` works at runtime.
  // @ts-expect-error exceljs xlsx.load Buffer typedef vs Uint8Array
  await xlsx.xlsx.load(buf)

  const sheetOrder: string[] = []
  const sheets: Record<string, Record<string, unknown>> = {}
  const styles: Record<string, Record<string, unknown>> = {}
  const styleKeyToId = new Map<string, string>()
  const sheetMeta = b64("{}")

  const styleIdForCell = (cell: ExcelJS.Cell) => {
    const raw = styleFromCell(cell)
    if (!raw) return undefined
    const fp = styleFingerprint(raw)
    let sid = styleKeyToId.get(fp)
    if (!sid) {
      sid = `s${styleKeyToId.size}`
      styleKeyToId.set(fp, sid)
      styles[sid] = raw
    }
    return sid
  }

  xlsx.eachSheet((sheet, sheetIdx) => {
    void sheetIdx
    const sid = crypto.randomUUID()
    sheetOrder.push(sid)
    const cellData: Record<string, Record<string, { v?: unknown; t?: number; s?: string }>> = {}

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const r0 = rowNumber - 1
      const rs = String(r0)
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const c0 = colNumber - 1
        const payload = cellPayload(cell)
        if (!payload) return
        const sidStyle = styleIdForCell(cell)
        const cs = String(c0)
        if (!cellData[rs]) cellData[rs] = {}
        cellData[rs][cs] = sidStyle ? { ...payload, s: sidStyle } : payload
      })
    })

    sheets[sid] = {
      id: sid,
      name: sheet.name || "Sheet",
      originalMeta: sheetMeta,
      tabColor: "",
      hidden: sheet.state === "hidden" ? 1 : 0,
      rowCount: 1000,
      columnCount: 26,
      defaultColumnWidth: 73,
      defaultRowHeight: 23,
      cellData,
      rowData: {},
      columnData: {},
      showGridlines: 1,
      rightToLeft: 0,
    }
  })

  if (!sheetOrder.length) throw new Error("no sheets")

  const workbookMeta = b64(JSON.stringify({ locale: "enUS", styles: {}, appVersion: "0.19.0" }))
  return {
    id: unitID,
    name: "Imported Workbook",
    schemaVersion: WORKBOOK_SCHEMA_VERSION,
    appVersion: "0.19.0",
    locale: "enUS",
    originalMeta: workbookMeta,
    styles,
    sheetOrder,
    sheets,
  }
}
