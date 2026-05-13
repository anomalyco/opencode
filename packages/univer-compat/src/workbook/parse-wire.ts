import { migrateWorkbookToLatest, workbookBodyFromSnapshotRoot } from "./schema-version/run"
import { coerceResourceDataStrings, workbookSurfaceSchema, type WorkbookWire } from "./surface"
import { plain } from "./util"

export function parseSnapshotWorkbook(snap: string): { root: Record<string, unknown>; wb: WorkbookWire } {
  const root = JSON.parse(snap) as Record<string, unknown>
  const raw = workbookBodyFromSnapshotRoot(root)
  migrateWorkbookToLatest(raw)
  coerceResourceDataStrings(raw)
  const ok = workbookSurfaceSchema.safeParse(raw)
  if (!ok.success) throw ok.error
  return { root, wb: raw as WorkbookWire }
}

/** Parse arbitrary workbook JSON (e.g. snapshot GET) into typed wire. */
export function parseWorkbookWire(raw: unknown): WorkbookWire {
  if (!plain(raw)) throw new Error("workbook must be an object")
  migrateWorkbookToLatest(raw)
  coerceResourceDataStrings(raw)
  const ok = workbookSurfaceSchema.safeParse(raw)
  if (!ok.success) throw ok.error
  return raw as WorkbookWire
}
