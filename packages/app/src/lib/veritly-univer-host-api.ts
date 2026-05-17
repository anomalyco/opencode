/** Ensures sheets facade extensions (`getActiveWorkbook`, …) are loaded for `FUniver`. */
import "@univerjs/sheets/facade"
import type { IWorkbookData, Univer } from "@univerjs/core"
import { commitDrawingPluginInWorkbook, parseWorkbookWire } from "@opencode-ai/univer-compat/drawing-plugin-normalize"
import { UniverInstanceType } from "@univerjs/core"
import type { FUniver } from "@univerjs/core/facade"
import type { PushCombMutationsInput, PushSetRangeInput, UniverHostApi } from "@opencode-ai/univer-sdk"

async function pollImportUnit(base: string, taskID: string) {
  for (let i = 0; i < 200; i++) {
    const r = await fetch(`${base}/universer-api/exchange/task/${encodeURIComponent(taskID)}`, {
      credentials: "include",
    })
    if (!r.ok) throw new Error(`task poll ${r.status}`)
    const j = (await r.json()) as {
      status?: string
      import?: { unitID?: string }
    }
    const uid = j.import?.unitID
    if (j.status === "done" && uid) return uid
    await new Promise((res) => setTimeout(res, 40))
  }
  throw new Error("import task timed out")
}

export type UniverPersistedUnitRow = { id: string; name: string }

/** Lists persisted sheet units for the signed-in user (S3-backed bundles on the compat server). */
export async function listPersistedUniverUnits(base: string): Promise<UniverPersistedUnitRow[]> {
  const b = base.replace(/\/$/, "")
  const r = await fetch(`${b}/universer-api/veritly/units`, { credentials: "include" })
  if (!r.ok) throw new Error(`veritly units ${r.status}`)
  const j = (await r.json()) as { units?: unknown }
  const rows = j.units
  if (!Array.isArray(rows)) throw new Error("veritly units response missing units")
  const out: UniverPersistedUnitRow[] = []
  for (const x of rows) {
    if (!x || typeof x !== "object") continue
    const id = Reflect.get(x, "id")
    const name = Reflect.get(x, "name")
    if (typeof id !== "string" || !id) continue
    out.push({ id, name: typeof name === "string" && name ? name : id })
  }
  return out
}

/** Upload xlsx: presign PUT to private bucket, then universer exchange import → unit id. */
export async function primitiveImportXlsx(base: string, file: File) {
  const buf = new Uint8Array(await file.arrayBuffer())
  const rawCt = file.type.trim()
  const ct =
    rawCt !== ""
      ? rawCt
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  const pr = await fetch(`${base}/universer-api/stream/file/presign-upload`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ size: buf.byteLength, contentType: ct }),
  })
  if (!pr.ok) throw new Error(`presign upload failed: ${pr.status}`)
  const presign = (await pr.json()) as { FileId?: string; uploadUrl?: string; headers?: Record<string, string> }
  const uploadUrl = presign.uploadUrl
  const fid = presign.FileId
  const hdrs = presign.headers
  if (!uploadUrl || !fid) throw new Error("presign response missing uploadUrl or FileId")
  if (!hdrs) throw new Error("presign response missing headers")
  const up = await fetch(uploadUrl, {
    method: "PUT",
    credentials: "omit",
    headers: hdrs,
    body: buf,
  })
  if (!up.ok) throw new Error(`object storage PUT failed: ${up.status}`)

  const ir = await fetch(`${base}/universer-api/exchange/2/import`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json;charset=UTF-8" },
    body: JSON.stringify({
      fileID: fid,
      outputType: 1,
      minSheetColumnCount: 1,
      minSheetRowCount: 1,
    }),
  })
  if (!ir.ok) throw new Error(`exchange import failed: ${ir.status}`)
  const imp = (await ir.json()) as { taskID?: string }
  if (!imp.taskID) throw new Error("import returned no taskID")
  return pollImportUnit(base, imp.taskID)
}

/** Fetch snapshot from universer and mount as the active sheet unit. Returns server revision for comb `baseRev` tracking. */
export async function primitiveLoadServerUnit(api: FUniver, univer: Univer, base: string, unitId: string, unitType: number) {
  const url = `${base}/universer-api/snapshot/${unitType}/unit/${encodeURIComponent(unitId)}/rev/0`
  const res = await fetch(url, { credentials: "include" })
  if (!res.ok) throw new Error(`snapshot GET ${res.status}`)
  const body = (await res.json()) as {
    snapshot?: { workbook?: Partial<IWorkbookData> }
    latestRevision?: number
  }
  const wb = body.snapshot?.workbook
  if (!wb) throw new Error("snapshot response missing workbook")

  const active = api.getActiveWorkbook?.()
  const existing = active?.getId?.()
  if (existing) api.disposeUnit(existing)

  const wire = parseWorkbookWire({ ...wb, id: wb.id !== undefined && wb.id !== null && wb.id !== "" ? wb.id : unitId })
  commitDrawingPluginInWorkbook(wire, "univer")
  univer.createUnit(UniverInstanceType.UNIVER_SHEET, wire as Partial<IWorkbookData>)

  return typeof body.latestRevision === "number" ? body.latestRevision : 0
}

type CombKey = string

function combKey(base: string, unitId: string): CombKey {
  return `${base}|${unitId}`
}

function mergeCellMaps(
  a: Record<string, Record<string, { v: unknown; t?: number }>>,
  b: Record<string, Record<string, { v: unknown; t?: number }>>,
) {
  const out: Record<string, Record<string, { v: unknown; t?: number }>> = { ...a }
  for (const rk of Object.keys(b)) {
    const rowB = b[rk]
    if (!rowB) continue
    const rowA = out[rk] ? { ...out[rk] } : {}
    for (const ck of Object.keys(rowB)) {
      rowA[ck] = rowB[ck] as { v: unknown; t?: number }
    }
    out[rk] = rowA
  }
  return out
}

export function augmentVeritlyHost(
  api: FUniver,
  univer: Univer,
  universerBase: string,
  opts?: { combDebounceMs?: number },
): UniverHostApi {
  const base = universerBase.replace(/\/$/, "")
  const debounceMs = opts && typeof opts.combDebounceMs === "number" ? opts.combDebounceMs : 140
  const head = new Map<CombKey, number>()
  const pending = new Map<CombKey, PushSetRangeInput>()
  const timers = new Map<CombKey, ReturnType<typeof setTimeout>>()

  const postCombMutations = async (input: PushCombMutationsInput, baseRev: number) => {
    const member = input.memberId ?? "veritly-browser"
    const res = await fetch(
      `${base}/universer-api/comb/2/unit/${encodeURIComponent(input.unitId)}/new_changes`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unitID: input.unitId,
          memberID: member,
          type: 2,
          changeset: {
            baseRev,
            unitID: input.unitId,
            memberID: member,
            mutations: input.mutations,
          },
        }),
      },
    )
    if (!res.ok) {
      const errBody = await res.text()
      throw new Error(`comb new_changes ${res.status}: ${errBody}`)
    }
    const j = (await res.json()) as { revision?: number }
    const r = j.revision
    if (typeof r !== "number") throw new Error("comb response missing revision")
    head.set(combKey(base, input.unitId), r)
    return r
  }

  const postComb = async (input: PushSetRangeInput, baseRev: number) => {
    return postCombMutations(
      {
        unitId: input.unitId,
        memberId: input.memberId,
        mutations: [
          {
            id: "sheet.mutation.set-range-values",
            params: {
              unitId: input.unitId,
              subUnitId: input.sheetId,
              cellValue: input.cellValue,
              ...(input.range !== undefined ? { range: input.range } : {}),
            },
          },
        ],
      },
      baseRev,
    )
  }

  const flush = async (k: CombKey) => {
    const raw = pending.get(k)
    if (!raw) return
    pending.delete(k)
    timers.delete(k)
    const tracked = head.get(k)
    if (tracked === undefined) throw new Error("push comb before loadServerUnit for this unit")
    const baseRev = raw.baseRev !== undefined ? raw.baseRev : tracked
    await postComb(raw, baseRev)
  }

  return Object.assign(api, {
    importXLSXToUnitIdAsync: (file: File) => primitiveImportXlsx(base, file),
    loadServerUnit: async (unitId: string, unitType: number) => {
      const r = await primitiveLoadServerUnit(api, univer, base, unitId, unitType)
      head.set(combKey(base, unitId), r)
      return r
    },
    pushCombMutationsToServer: async (input: PushCombMutationsInput) => {
      const k = combKey(base, input.unitId)
      const t = timers.get(k)
      if (t) clearTimeout(t)
      timers.delete(k)
      if (pending.has(k)) await flush(k)
      const tracked = head.get(k)
      if (tracked === undefined) throw new Error("push comb before loadServerUnit for this unit")
      const baseRev = input.baseRev !== undefined ? input.baseRev : tracked
      return postCombMutations(input, baseRev)
    },
    pushSetRangeToServer: async (input: PushSetRangeInput) => {
      const k = combKey(base, input.unitId)
      const t = timers.get(k)
      if (t) clearTimeout(t)
      timers.delete(k)
      pending.delete(k)
      const tracked = head.get(k)
      if (tracked === undefined) throw new Error("push comb before loadServerUnit for this unit")
      const baseRev = input.baseRev !== undefined ? input.baseRev : tracked
      return postComb(input, baseRev)
    },
    pushSetRangeToServerDebounced: (input: PushSetRangeInput) => {
      const k = combKey(base, input.unitId)
      const cur = pending.get(k)
      const next = cur
        ? { ...input, cellValue: mergeCellMaps(cur.cellValue, input.cellValue) }
        : input
      pending.set(k, next)
      const prior = timers.get(k)
      if (prior) clearTimeout(prior)
      const tid = setTimeout(() => {
        timers.delete(k)
        void flush(k)
      }, debounceMs)
      timers.set(k, tid)
    },
    flushVeritlyCombForUnit: async (unitId: string) => {
      const k = combKey(base, unitId)
      const t = timers.get(k)
      if (t) clearTimeout(t)
      timers.delete(k)
      if (!pending.has(k)) return
      await flush(k)
    },
  }) as unknown as UniverHostApi
}
