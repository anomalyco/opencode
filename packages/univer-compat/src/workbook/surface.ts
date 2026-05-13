import * as z from "zod"
import { plain } from "./util"

function coerceResourceDataStrings(wb: Record<string, unknown>) {
  const list = wb.resources
  if (!Array.isArray(list)) return
  for (const r of list) {
    if (!plain(r)) continue
    const d = r.data
    r.data = typeof d === "string" ? d : JSON.stringify(d !== undefined && d !== null ? d : {})
  }
}

const resourceRowSchema = z.object({ name: z.string(), data: z.string() }).passthrough()

export const workbookSurfaceSchema = z
  .object({
    schemaVersion: z.number().int().min(0).optional(),
    unitID: z.string().optional(),
    id: z.string().optional(),
    rev: z.number().optional(),
    resources: z.array(resourceRowSchema).optional(),
    sheets: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    sheetOrder: z.array(z.string()).optional(),
  })
  .passthrough()

export type WorkbookWire = z.infer<typeof workbookSurfaceSchema>

export { coerceResourceDataStrings }

export function sheetIdsFromWorkbook(wb: Pick<WorkbookWire, "sheetOrder" | "sheets">): string[] {
  const o = wb.sheetOrder
  if (Array.isArray(o) && o.length) return o.map(String)
  const s = wb.sheets
  if (plain(s)) return Object.keys(s)
  return []
}
