import * as json1 from "ot-json1"
import * as z from "zod"
import type { WorkbookWire } from "./surface"
import { sheetIdsFromWorkbook } from "./surface"
import { jsonClone, plain } from "./util"

export const SHEET_DRAWING_PLUGIN = "SHEET_DRAWING_PLUGIN"

const drawingSlotSchema = z
  .object({
    data: z.record(z.string(), z.unknown()).optional(),
    order: z.array(z.string()).optional(),
  })
  .transform((o) => ({
    data: plain(o.data) ? o.data : {},
    order: Array.isArray(o.order) ? o.order.filter((x): x is string => typeof x === "string") : [],
  }))

export type DrawingSlot = z.infer<typeof drawingSlotSchema>

const compatDrawingDocSchema = z.record(z.string(), z.record(z.string(), drawingSlotSchema))

export type CompatDrawingDoc = z.infer<typeof compatDrawingDocSchema>

const univerDrawingDocSchema = z.record(z.string(), drawingSlotSchema)

/** Parsed JSON object for a `resources[].data` string (never array / null). */
export function parseDrawingResourceBlob(raw: string): Record<string, unknown> {
  if (!raw.length) return {}
  let p: unknown
  try {
    p = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!p || typeof p !== "object" || Array.isArray(p)) return {}
  return p as Record<string, unknown>
}

function unitIdFromWorkbook(wb: Pick<WorkbookWire, "unitID" | "id">): string | undefined {
  const u = wb.unitID
  if (typeof u === "string" && u.length) return u
  const id = wb.id
  if (typeof id === "string" && id.length) return id
  return undefined
}

function reparentMisplacedSheetRoot(doc: Record<string, unknown>, sheetIds: string[]) {
  const keys = Object.keys(doc)
  if (keys.length !== 2 || !keys.includes("data") || !keys.includes("order")) return
  const sid = sheetIds[0]
  if (!sid) return
  if (!plain(doc.data) || !Array.isArray(doc.order)) return
  const data = doc.data
  const order = doc.order
  for (const k of keys) delete doc[k]
  doc[sid] = { data, order }
}

function unwrapCompatUnitWrapper(doc: Record<string, unknown>, wb: Pick<WorkbookWire, "sheetOrder" | "sheets" | "unitID" | "id">) {
  const sheetIds = sheetIdsFromWorkbook(wb)
  if (!sheetIds.length) return
  const set = new Set(sheetIds)
  const top = Object.keys(doc)
  if (top.length !== 1) return
  const wrap = top[0]
  if (set.has(wrap)) return
  const inner = doc[wrap]
  if (!plain(inner)) return
  const innerKeys = Object.keys(inner)
  if (!innerKeys.length || !innerKeys.every((k) => set.has(k))) return
  const uid = unitIdFromWorkbook(wb)
  if (uid !== undefined && wrap !== uid) return
  for (const k of innerKeys) doc[k] = inner[k]!
  delete doc[wrap]
}

function drawingResourceDataToDoc(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") return parseDrawingResourceBlob(raw.length ? raw : "{}")
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return raw as Record<string, unknown>
}

export function openCompatDrawingDoc(raw: string, unitId: string): CompatDrawingDoc {
  const r = parseDrawingResourceBlob(raw)
  const c = compatDrawingDocSchema.safeParse(r)
  if (c.success) return c.data
  const u = univerDrawingDocSchema.safeParse(r)
  if (u.success && unitId.length) return compatDrawingDocSchema.parse({ [unitId]: u.data })
  return compatDrawingDocSchema.parse({})
}

export function serializeCompatDrawingDoc(doc: CompatDrawingDoc): string {
  return JSON.stringify(compatDrawingDocSchema.parse(doc))
}

const liveDrawingBySlot = new WeakMap<{ name: string; data: string }, CompatDrawingDoc>()

function drawingPluginSlot(wb: WorkbookWire): { name: string; data: string } {
  if (!wb.resources) wb.resources = []
  const list = wb.resources
  let row = list.find((r) => r.name === SHEET_DRAWING_PLUGIN)
  if (!row) {
    row = { name: SHEET_DRAWING_PLUGIN, data: "{}" }
    list.push(row)
  }
  return row
}

/** One parse per workbook + plugin row; returns the live typed doc (mutate in place). */
export function compatDrawingLive(wb: WorkbookWire, unitId: string): CompatDrawingDoc {
  const row = drawingPluginSlot(wb)
  let doc = liveDrawingBySlot.get(row)
  if (!doc) {
    doc = openCompatDrawingDoc(row.data, unitId)
    liveDrawingBySlot.set(row, doc)
  }
  return doc
}

/** Writes live drawing doc back to `resources[].data` and drops the parse cache entry. */
export function freezeCompatDrawingLive(wb: WorkbookWire) {
  if (!wb.resources) return
  const row = wb.resources.find((r) => r.name === SHEET_DRAWING_PLUGIN)
  if (!row) return
  const doc = liveDrawingBySlot.get(row)
  if (!doc) return
  row.data = serializeCompatDrawingDoc(doc)
  liveDrawingBySlot.delete(row)
}

function ensureDrawingScaffold(doc: CompatDrawingDoc, unitId: string, subUnitId: string) {
  let u = doc[unitId]
  if (!u) u = {}
  doc[unitId] = u
  let s = u[subUnitId]
  if (!s) s = { data: {}, order: [] }
  u[subUnitId] = drawingSlotSchema.parse(s)
}

function applyOrderInsert(order: string[], idx: number, id: string) {
  const next = order.filter((x) => x !== id)
  const at = Math.max(0, Math.min(idx, next.length))
  next.splice(at, 0, id)
  for (let i = 0; i < next.length; i++) order[i] = next[i]
  order.length = next.length
}

function applyNestedDrawingInsert(doc: CompatDrawingDoc, unitId: string, subUnitId: string, op: unknown[]) {
  ensureDrawingScaffold(doc, unitId, subUnitId)
  const sheet = doc[unitId][subUnitId]
  const data = sheet.data
  const order = sheet.order
  const dataOp = op[2] as [string, string, { i: unknown }]
  const id = dataOp[1]
  const inner = dataOp[2] as { i: unknown }
  const drawing = inner.i
  if (drawing && typeof drawing === "object" && !Array.isArray(drawing)) {
    data[id] = { ...(drawing as Record<string, unknown>) }
  }
  for (let k = 3; k < op.length; k++) {
    const part = op[k]
    if (!Array.isArray(part) || part.length < 3) continue
    if (part[0] !== "order") continue
    const ix = part[1]
    if (typeof ix !== "number") continue
    const ow = part[2]
    if (!ow || typeof ow !== "object") continue
    if (!("i" in ow)) continue
    const ins = (ow as { i: unknown }).i
    if (typeof ins === "string") applyOrderInsert(order, ix, ins)
  }
}

function mergeFlatDrawingPatches(leaf: Record<string, unknown>, tail: unknown[]) {
  for (const item of tail) {
    if (!Array.isArray(item) || item.length < 2) continue
    const key = item[0]
    const body = item[1]
    if (typeof key !== "string" || !body || typeof body !== "object") continue
    const b = body as Record<string, unknown>
    if ("i" in b) leaf[key] = b.i
  }
}

function isFlatDrawingDataOp(op: unknown): op is [string, string, "data", string, ...unknown[]] {
  if (!Array.isArray(op) || op.length < 5) return false
  if (typeof op[0] !== "string" || typeof op[1] !== "string") return false
  if (op[2] !== "data") return false
  if (typeof op[3] !== "string") return false
  return true
}

function isNestedDrawingInsertOp(op: unknown): op is [string, string, unknown[], ...unknown[]] {
  if (!Array.isArray(op) || op.length < 4) return false
  if (typeof op[0] !== "string" || typeof op[1] !== "string") return false
  const data = op[2]
  if (!Array.isArray(data) || data.length < 3) return false
  if (data[0] !== "data") return false
  if (typeof data[1] !== "string") return false
  const wrap = data[2]
  if (!wrap || typeof wrap !== "object") return false
  if (!("i" in wrap)) return false
  return true
}

/** Apply `sheet.mutation.set-drawing-apply` against the live compat drawing doc (already opened). */
export function applySetDrawingApplyTyped(wb: WorkbookWire, params: Record<string, unknown>): boolean {
  const op = params.op
  if (op === undefined) return false
  const unitId = params.unitId
  const subUnitId = params.subUnitId
  if (typeof unitId !== "string" || !unitId.length) return false
  if (typeof subUnitId !== "string" || !subUnitId.length) return false
  const doc = compatDrawingLive(wb, unitId)
  ensureDrawingScaffold(doc, unitId, subUnitId)
  const data = doc[unitId][subUnitId].data

  if (isFlatDrawingDataOp(op)) {
    const id = op[3]
    let leaf = data[id]
    if (!leaf || typeof leaf !== "object") {
      leaf = {}
      data[id] = leaf
    }
    mergeFlatDrawingPatches(leaf as Record<string, unknown>, op.slice(4))
    return true
  }

  if (isNestedDrawingInsertOp(op)) {
    applyNestedDrawingInsert(doc, unitId, subUnitId, op as unknown[])
    return true
  }

  let applied: unknown
  try {
    applied = json1.type.apply(doc as unknown as json1.Doc, op as json1.JSONOp)
  } catch {
    if (Array.isArray(op) && op.length >= 4) {
      const maybe = op[2]
      if (Array.isArray(maybe) && maybe[0] === "data" && typeof maybe[1] === "string") {
        applyNestedDrawingInsert(doc, unitId, subUnitId, op as unknown[])
        return true
      }
    }
    return false
  }
  const next = compatDrawingDocSchema.safeParse(applied)
  if (!next.success) return false
  const row = drawingPluginSlot(wb)
  liveDrawingBySlot.set(row, next.data)
  return true
}

/** Serialize `SHEET_DRAWING_PLUGIN` for Univer `createUnit` / GET envelope. */
export function commitDrawingPluginInWorkbook(wb: WorkbookWire, mode: "compat" | "univer") {
  freezeCompatDrawingLive(wb)
  const resources = wb.resources
  if (!Array.isArray(resources)) return
  let uid = ""
  if (typeof wb.unitID === "string" && wb.unitID.length) uid = wb.unitID
  else if (typeof wb.id === "string" && wb.id.length) uid = wb.id
  for (const r of resources) {
    if (!plain(r)) continue
    if (Reflect.get(r, "name") !== SHEET_DRAWING_PLUGIN) continue
    const raw = Reflect.get(r, "data")
    const str = typeof raw === "string" ? raw : JSON.stringify(raw !== undefined && raw !== null ? raw : {})
    if (mode === "compat") {
      Reflect.set(r, "data", serializeCompatDrawingDoc(openCompatDrawingDoc(str, uid)))
      continue
    }
    const base = drawingResourceDataToDoc(str)
    const copy = jsonClone(base)
    reparentMisplacedSheetRoot(copy, sheetIdsFromWorkbook(wb))
    unwrapCompatUnitWrapper(copy, wb)
    Reflect.set(r, "data", JSON.stringify(univerDrawingDocSchema.parse(copy)))
  }
}
