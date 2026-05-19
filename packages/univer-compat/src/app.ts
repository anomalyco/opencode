import type { Context } from "hono"
import { Hono } from "hono"
import { okErr } from "./err"
import { flattenChangesetRecords, patchChangesetRevision } from "./changeset"
import { buildRealSnapshotEnvelope } from "./workbook"
import { Conflict, MergeFailed, Missing, Store } from "./store"
import { jsonResponse } from "./json-response"

import { exchangePresignActor } from "./presign-actor"
import type { SessionResolver } from "@veritly/auth-shared"
import { univerCompatAuthMiddleware } from "./auth-middleware"

function corsHeaders(req: Request) {
  const h = new Headers()
  const origin = req.headers.get("Origin") ?? ""
  if (origin && allowedOrigin(origin)) {
    h.set("Access-Control-Allow-Origin", origin)
    h.set("Access-Control-Allow-Credentials", "true")
  }
  h.set("Vary", "Origin, Access-Control-Request-Headers")
  h.set("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS")
  const reqHeaders = (req.headers.get("Access-Control-Request-Headers") ?? "").trim()
  if (reqHeaders) h.set("Access-Control-Allow-Headers", reqHeaders)
  else
    h.set(
      "Access-Control-Allow-Headers",
      "Content-Type,Authorization,Cookie,x-veritly-project-id,x-api-key,x-univer-host,x-veritly-univer-test-user",
    )
  return h
}

function allowedOrigin(origin: string) {
  const u = new URL(origin)
  const scheme = u.protocol.replace(":", "").toLowerCase()
  const host = u.hostname.toLowerCase()
  if (scheme === "http" && (host === "localhost" || host === "127.0.0.1")) return true
  if (scheme === "https" && (host === "veritly.co.uk" || host.endsWith(".veritly.co.uk"))) return true
  return false
}

function writeFormulaLimit() {
  return jsonResponse({
    error: okErr(),
    limitInfo: {
      maxFormulaLimit: 0,
      currentUsage: 0,
      availableSlots: 0,
      granted: true,
    },
  })
}

function parseIntPath(s: string) {
  const n = Number.parseInt(s, 10)
  if (Number.isNaN(n)) return undefined
  return n
}

export function createCompatApp(store: Store, auth: SessionResolver) {
  const app = new Hono()

  app.use("*", async (c, next) => {
    const headers = corsHeaders(c.req.raw)
    for (const [k, v] of headers) c.header(k, v)
    if (c.req.method === "OPTIONS") return c.body(null, 204)
    await next()
  })

  app.use("*", univerCompatAuthMiddleware(auth))

  app.get("/livez", (c) => c.text("ok"))
  app.get("/readyz", (c) => c.json({ ok: true }))

  app.get("/universer-api/user/session-ticket", (c) =>
    c.json({
      error: okErr(),
      ticket: "phase1-non-collab-ticket",
    }),
  )

  app.post("/universer-api/authz/allowed", (c) =>
    c.json({
      error: okErr(),
      actions: [],
    }),
  )

  app.post("/universer-api/authz/batch-allowed", (c) =>
    c.json({
      error: okErr(),
      objectActions: [],
    }),
  )

  app.post("/universer-api/authz/-/object/-/batch_allowed", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      requests?: { unitID?: string; objectID?: string; objectType?: number; actions?: number[] }[]
    }
    const requests = body.requests ?? []
    const objectActions = requests.map((q) => ({
      unitID: q.unitID,
      objectID: q.objectID,
      actions: (q.actions ?? []).map((a) => ({ action: a, allowed: true })),
    }))
    return c.json({
      error: okErr(),
      objectActions,
    })
  })

  app.post("/universer-api/authz/-/object/-/allowed", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      unitID?: string
      objectID?: string
      objectType?: number
      actions?: number[]
    }
    const actions = (body.actions ?? []).map((a) => ({ action: a, allowed: true }))
    return c.json({
      error: okErr(),
      actions,
    })
  })

  app.get("/universer-api/authz/list-collaborators", (c) =>
    c.json({
      error: okErr(),
      collaborators: [],
    }),
  )

  app.get("/universer-api/veritly/units", async (c) => {
    const units = await store.listPersistedSheetUnits()
    return c.json({ error: okErr(), units })
  })

  app.post("/universer-api/stream/file/presign-upload", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { size?: unknown; contentType?: unknown }
    const size = body.size
    if (typeof size !== "number" || !Number.isFinite(size)) return c.json({ error: "invalid size" }, 400)
    const rawCt = body.contentType
    const ct =
      typeof rawCt === "string" && rawCt.trim()
        ? rawCt.trim()
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    let out: { FileId: string; url: string; headers: Record<string, string> }
    try {
      out = await store.beginPresignedExchangeUpload(ct, size)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === "invalid size") return c.json({ error: msg }, 400)
      throw e
    }
    const origin = new URL(c.req.url).origin
    const uploadUrl = out.url.startsWith("http") ? out.url : `${origin}${out.url}`
    return c.json({
      error: okErr(),
      FileId: out.FileId,
      uploadUrl,
      headers: out.headers,
    })
  })

  const mem = store.memoryExchange()
  if (mem) {
    app.put("/universer-api/_memory_exchange_put/:token", async (c) => {
      const raw = await c.req.arrayBuffer()
      try {
        mem.finishPresignedPut(c.req.param("token"), exchangePresignActor(), new Uint8Array(raw))
      } catch {
        return c.json({ error: "invalid presign" }, 400)
      }
      return c.body(null, 204)
    })
    app.get("/universer-api/_memory_exchange_get/:token", async (c) => {
      const key = mem.consumePresignedGetToken(c.req.param("token"), exchangePresignActor())
      if (!key) return c.json({ error: "not found" }, 404)
      const bytes = await mem.get(key)
      return new Response(Buffer.from(bytes), {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      })
    })
  }

  app.get("/universer-api/file/:fileID/sign-url", async (c) => {
    const id = c.req.param("fileID")
    if (!(await store.fileExists(id))) {
      return c.json({ error: { code: 404, message: "file not found" } }, 404)
    }
    const signed = await store.presignedGetExchangeFile(id, 300)
    const origin = new URL(c.req.url).origin
    const url = signed.url.startsWith("http") ? signed.url : `${origin}${signed.url}`
    return c.json({
      error: okErr(),
      url,
    })
  })

  app.post("/universer-api/exchange/:type/import", async (c) => {
    const typ = parseIntPath(c.req.param("type"))
    if (typ === undefined) return c.json({ error: "invalid type" }, 400)
    const body = (await c.req.json()) as { fileID?: string }
    const fid = body.fileID
    if (typeof fid !== "string" || !fid.trim()) {
      return c.json({ error: { code: 40441, message: "file not found" } }, 404)
    }
    let taskID: string
    try {
      taskID = await store.createImportTask(typ, fid.trim())
    } catch (e) {
      if (e instanceof Missing) return c.json({ error: { code: 40441, message: "file not found" } }, 404)
      return c.json(
        {
          error: { code: 40050, message: e instanceof Error ? e.message : String(e) },
          taskID: "",
        },
        400,
      )
    }
    return c.json({
      error: okErr(),
      taskID,
    })
  })

  app.post("/universer-api/exchange/:type/export", (c) =>
    c.json({ error: { code: 50121, message: "export not implemented yet" } }, 501),
  )

  app.get("/universer-api/exchange/task/:taskID", (c) => {
    const taskID = c.req.param("taskID")
    let t
    try {
      t = store.task(taskID)
    } catch (e) {
      if (e instanceof Missing) return c.json({ error: { code: 40442, message: "task not found" } }, 404)
      throw e
    }
    return c.json({
      error: okErr(),
      taskID: t.id,
      status: t.status,
      import: {
        outputType: t.outputType,
        unitID: t.importUnit,
        jsonID: "",
      },
    })
  })

  app.post("/universer-api/snapshot/:type/unit/-/create", async (c) => {
    const typ = parseIntPath(c.req.param("type"))
    if (typ === undefined) return c.json({ error: "invalid type" }, 400)
    if (typ !== 2) return c.json({ error: { code: 40021, message: "phase 1 supports sheets type=2 only" } }, 400)
    const body = (await c.req.json()) as { name?: string; creator?: string }
    const u = store.createUnit(body.name ?? "Sheet", body.creator ?? "user", typ)
    await store.maybePersistUnit(u.id, u.revision, true)
    return c.json({
      error: okErr(),
      unitID: u.id,
    })
  })

  app.get("/universer-api/snapshot/:type/unit/:unitID/rev/:revision/ensure", async (c) => {
    const typ = parseIntPath(c.req.param("type"))
    const unitID = c.req.param("unitID")
    const rev = Number.parseInt(c.req.param("revision"), 10)
    if (typ === undefined || Number.isNaN(rev)) return c.json({ error: "invalid path" }, 400)
    if (typ !== 2) return c.json({ error: { code: 40021, message: "phase 1 supports sheets type=2 only" } }, 400)
    await store.hydrateUnit(unitID)
    try {
      store.ensureSnapshot(unitID, rev)
    } catch (e) {
      if (e instanceof Missing) return c.json({ error: { code: 40401, message: "snapshot not found" } }, 404)
      throw e
    }
    return c.json({ error: okErr() })
  })

  app.get("/universer-api/snapshot/:type/unit/:unitID/rev/:revision", async (c) => {
    const typ = parseIntPath(c.req.param("type"))
    const unitID = c.req.param("unitID")
    const rev = Number.parseInt(c.req.param("revision"), 10)
    if (typ === undefined || Number.isNaN(rev)) return c.json({ error: "invalid path" }, 400)
    if (typ !== 2) return c.json({ error: { code: 40021, message: "phase 1 supports sheets type=2 only" } }, 400)
    await store.hydrateUnit(unitID)
    let u
    try {
      u = store.unit(unitID, typ)
    } catch (e) {
      if (e instanceof Missing) return c.json({ error: { code: 40402, message: "unit not found" } }, 404)
      throw e
    }
    let effective = rev
    if (rev === 0 && u.revision > 0) effective = u.revision
    let snap: string
    let trail
    try {
      const r = store.getUnitOnRev(unitID, typ, effective)
      snap = r.snap
      trail = r.trail
    } catch (e) {
      if (e instanceof Missing) return c.json({ error: { code: 40402, message: "unit not found" } }, 404)
      throw e
    }
    const out = buildRealSnapshotEnvelope(unitID, typ, effective, snap) as Record<string, unknown>
    out.error = okErr()
    /** Incremental edit log for this unit (not replayed by the app on load; `snapshot.workbook` is already merged). */
    out.changesets = flattenChangesetRecords(trail)
    out.latestRevision = u.revision
    return c.json(out)
  })

  app.post("/universer-api/snapshot/:type/unit/:unitID/save", async (c) => {
    const typ = parseIntPath(c.req.param("type"))
    const unitID = c.req.param("unitID")
    if (typ === undefined) return c.json({ error: "invalid type" }, 400)
    if (typ !== 2) return c.json({ error: { code: 40021, message: "phase 1 supports sheets type=2 only" } }, 400)
    const body = (await c.req.json()) as { snapshot?: unknown; baseRev?: number; memberID?: string }
    await store.hydrateUnit(unitID)
    let rev: number
    try {
      rev = store.saveSnapshot(unitID, typ, body.baseRev ?? 0, body.memberID ?? "", body.snapshot)
    } catch (e) {
      if (e instanceof Conflict) return c.json({ error: { code: 40901, message: "revision conflict" } }, 409)
      if (e instanceof Missing) return c.json({ error: { code: 40403, message: "unit not found" } }, 404)
      throw e
    }
    await store.maybePersistUnit(unitID, rev, false)
    return c.json({
      error: okErr(),
      revision: rev,
    })
  })

  app.post("/universer-api/snapshot/:type/unit/:unitID/changeset", async (c) => {
    const typ = parseIntPath(c.req.param("type"))
    const unitID = c.req.param("unitID")
    if (typ === undefined) return c.json({ error: "invalid type" }, 400)
    if (typ !== 2) return c.json({ error: { code: 40021, message: "phase 1 supports sheets type=2 only" } }, 400)
    const body = (await c.req.json()) as { baseRev?: number; memberID?: string; changeset?: unknown }
    const raw = JSON.stringify(body.changeset ?? {})
    await store.hydrateUnit(unitID)
    let rev: number
    try {
      rev = store.saveChangeset(unitID, typ, body.baseRev ?? 0, body.memberID ?? "", raw)
    } catch (e) {
      if (e instanceof Conflict) return c.json({ error: { code: 40902, message: "revision conflict" } }, 409)
      if (e instanceof MergeFailed) return c.json({ error: { code: 42201, message: "changeset merge failed" } }, 422)
      if (e instanceof Missing) return c.json({ error: { code: 40404, message: "unit not found" } }, 404)
      throw e
    }
    await store.maybePersistUnit(unitID, rev, false)
    return c.json({
      error: okErr(),
      revision: rev,
    })
  })

  app.get("/universer-api/snapshot/:type/unit/:unitID/changesets", async (c) => {
    const typ = parseIntPath(c.req.param("type"))
    const unitID = c.req.param("unitID")
    const from = Number.parseInt(c.req.query("from") ?? "0", 10)
    const to = Number.parseInt(c.req.query("to") ?? "0", 10)
    if (typ === undefined) return c.json({ error: "invalid type" }, 400)
    await store.hydrateUnit(unitID)
    let list
    let latest: number
    try {
      const r = store.missingChangesets(unitID, typ, from, to)
      list = r.list
      latest = r.latest
    } catch (e) {
      if (e instanceof Missing) return c.json({ error: { code: 40405, message: "unit not found" } }, 404)
      throw e
    }
    return c.json({
      error: okErr(),
      changesets: flattenChangesetRecords(list),
      latestRevision: latest,
    })
  })

  app.get("/universer-api/snapshot/block/:type/unit/:unitID/block/:blockID", async (c) => {
    const typ = parseIntPath(c.req.param("type"))
    const unitID = c.req.param("unitID")
    const blockID = c.req.param("blockID")
    if (typ !== 2) return c.json({ error: "invalid type" }, 400)
    await store.hydrateUnit(unitID)
    let snap: string
    try {
      snap = store.latestSnapshot(unitID, typ).snap
    } catch (e) {
      if (e instanceof Missing) return c.json({ error: { code: 40402, message: "unit not found" } }, 404)
      throw e
    }
    const root = JSON.parse(snap) as Record<string, unknown>
    let wb = root
    const nested = root.workbook
    if (nested && typeof nested === "object") wb = nested as Record<string, unknown>
    const blockMeta = wb.blockMeta as Record<string, Record<string, unknown>> | undefined
    let sheetID = ""
    if (blockMeta && typeof blockMeta === "object") {
      for (const raw of Object.values(blockMeta)) {
        const m = raw as { blocks?: unknown[]; sheetID?: string }
        const bs = m.blocks
        if (!Array.isArray(bs)) continue
        if (bs.some((b) => String(b) === blockID)) {
          sheetID = String(m.sheetID ?? "")
          break
        }
      }
    }
    const order = wb.sheetOrder as unknown[] | undefined
    if (!sheetID && order?.length) sheetID = String(order[0])
    const sheets = wb.sheets as Record<string, Record<string, unknown>> | undefined
    if (!sheetID || !sheets?.[sheetID]) {
      return c.json({ error: { code: 40411, message: "block not found" } }, 404)
    }
    const sh = sheets[sheetID]
    const cellData = sh.cellData as Record<string, Record<string, Record<string, unknown>>> | undefined
    const blockData: Record<string, Record<string, unknown>> = {}
    let maxRow = 0
    if (cellData) {
      for (const rKey of Object.keys(cellData)) {
        const rowObj = cellData[rKey]
        const rowOut: Record<string, Record<string, unknown>> = {}
        for (const cKey of Object.keys(rowObj)) {
          const cellObj = rowObj[cKey] as Record<string, unknown>
          const one: Record<string, unknown> = {}
          for (const ck of Object.keys(cellObj)) one[ck] = cellObj[ck]
          if (Object.keys(one).length) rowOut[cKey] = one
        }
        if (Object.keys(rowOut).length) {
          blockData[rKey] = rowOut
          const rv = Number.parseInt(rKey, 10)
          if (!Number.isNaN(rv) && rv > maxRow) maxRow = rv
        }
      }
    }
    return c.json({
      error: { code: 1 },
      block: {
        id: blockID,
        endRow: maxRow,
        data: blockData,
      },
    })
  })

  const serveComb = async (c: Context, pathUnit: string, pathType: number) => {
    const raw = await c.req.text()
    const envelope = JSON.parse(raw) as Record<string, unknown>
    let unitID = stringField(envelope.unitID)
    let memberID = stringField(envelope.memberID)
    let typ = intField(envelope.type)
    if (typ === 0) typ = 2
    if (pathUnit) {
      if (unitID && unitID !== pathUnit) return c.json({ error: "unitID mismatch" }, 400)
      unitID = pathUnit
    }
    if (pathType !== 0) {
      if (typ !== 0 && typ !== pathType) return c.json({ error: "type mismatch" }, 400)
      typ = pathType
    }
    const csObj = envelope.changeset
    if (csObj === undefined) return c.json({ error: "missing changeset" }, 400)
    const csBytes = JSON.stringify(csObj)
    const csMap = JSON.parse(csBytes) as Record<string, unknown>
    const baseRev = int64Field(csMap.baseRev)
    if (!memberID) memberID = stringField(csMap.memberID)
    if (!unitID) unitID = stringField(csMap.unitID)
    if (!unitID) return c.json({ error: "invalid unitID" }, 400)
    await store.hydrateUnit(unitID)
    let rev: number
    try {
      rev = store.saveChangeset(unitID, typ, baseRev, memberID, csBytes)
    } catch (e) {
      if (e instanceof Conflict) return c.json({ error: { code: 40902, message: "revision conflict" } }, 409)
      if (e instanceof MergeFailed) return c.json({ error: { code: 42201, message: "changeset merge failed" } }, 422)
      if (e instanceof Missing) return c.json({ error: { code: 40404, message: "unit not found" } }, 404)
      throw e
    }
    await store.maybePersistUnit(unitID, rev, false)
    const ackRaw = patchChangesetRevision(csBytes, rev)
    const ackCS = JSON.parse(ackRaw) as Record<string, unknown>
    const ackEnvelope = JSON.parse(raw) as Record<string, unknown>
    const nested = ackEnvelope.changeset as Record<string, unknown> | undefined
    if (nested) nested.revision = rev
    return c.json({
      error: okErr(),
      revision: rev,
      changeset: ackCS,
      body: ackEnvelope,
    })
  }

  app.post("/universer-api/comb/new-change", async (c) => serveComb(c, "", 0))

  app.post("/universer-api/comb/:type/unit/:unitID/new_changes", async (c) => {
    const pathType = parseIntPath(c.req.param("type")) ?? 0
    const pathUnit = c.req.param("unitID").trim()
    if (!pathUnit) return c.json({ error: "invalid path" }, 400)
    return serveComb(c, pathUnit, pathType)
  })

  app.get("/universer-api/comb/connect", (c) => {
    const upgrade = c.req.header("Upgrade")?.toLowerCase()
    if (upgrade !== "websocket") {
      return c.json(
        {
          error:
            "GET /universer-api/comb/connect expects Upgrade: websocket — handled by Bun.serve (binary `@univerjs/protocol` comb not implemented server-side yet)",
        },
        400,
      )
    }
    return c.json({ error: "WebSocket upgrade must be handled at Bun.serve (see univer-compat/script/serve.ts)" }, 500)
  })

  app.post("/universer-api/license/formula/limit/start", async (c) => {
    await c.req.arrayBuffer()
    return writeFormulaLimit()
  })

  app.get("/universer-api/license/formula/limit/status", () => writeFormulaLimit())

  app.post("/universer-api/license/formula/limit/done", async (c) => {
    await c.req.arrayBuffer()
    return writeFormulaLimit()
  })

  app.notFound((c) => c.json({ error: "not found" }, 404))

  return app
}

function stringField(v: unknown) {
  return typeof v === "string" ? v : ""
}

function intField(v: unknown) {
  if (typeof v === "number" && !Number.isNaN(v)) return v
  return 0
}

function int64Field(v: unknown) {
  if (typeof v === "number") return v
  return 0
}
