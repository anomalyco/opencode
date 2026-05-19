import { auth, projHdr } from "./setup-compat-auth"
import { describe, expect, test } from "bun:test"
import * as XLSX from "xlsx"
import { createCompatApp } from "../src/app"
import { Store } from "../src/store"
import { MemoryExchangeFiles } from "../src/memory-exchange-files"
import { exchangePresignPut } from "./helpers/exchange-presign-upload"

function minimalXlsx() {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([["hello"]])
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }))
}

describe("univer-compat exchange + snapshot", () => {
  test("missing x-veritly-project-id returns 400 on presign-upload", async () => {
    const app = createCompatApp(new Store(new MemoryExchangeFiles(), 1), auth)
    const r = await app.request("http://127.0.0.1/universer-api/stream/file/presign-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        size: 10,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    })
    expect(r.status).toBe(400)
  })

  test("listPersistedSheetUnits is scoped to x-veritly-project-id", async () => {
    const store = new Store(new MemoryExchangeFiles(), 1)
    const app = createCompatApp(store, auth)
    const pa = { "x-veritly-project-id": "proj-alpha" }
    const pb = { "x-veritly-project-id": "proj-beta" }
    const xlsx = minimalXlsx()
    const fid = await exchangePresignPut(app, xlsx, undefined, pa)
    const ir = await app.request("http://127.0.0.1/universer-api/exchange/2/import", {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8", ...pa },
      body: JSON.stringify({
        fileID: fid,
        outputType: 1,
        minSheetColumnCount: 1,
        minSheetRowCount: 1,
      }),
    })
    expect(ir.status).toBe(200)
    const imp = (await ir.json()) as { taskID: string }
    const tr = await app.request(`http://127.0.0.1/universer-api/exchange/task/${imp.taskID}`, {
      headers: pa,
    })
    expect(tr.status).toBe(200)

    const listA = await app.request("http://127.0.0.1/universer-api/veritly/units", { headers: pa })
    expect(listA.status).toBe(200)
    const rowsA = (await listA.json()) as { units: { id: string; name: string }[] }
    expect(rowsA.units.length).toBe(1)

    const listB = await app.request("http://127.0.0.1/universer-api/veritly/units", { headers: pb })
    expect(listB.status).toBe(200)
    const rowsB = (await listB.json()) as { units: { id: string; name: string }[] }
    expect(rowsB.units.length).toBe(0)
  })

  test("upload raw then exchange matches universer shape", async () => {
    const store = new Store(new MemoryExchangeFiles(), 1)
    const app = createCompatApp(store, auth)
    const xlsx = minimalXlsx()
    const fid = await exchangePresignPut(app, xlsx)
    expect(fid.length).toBeGreaterThan(0)

    const payload = JSON.stringify({
      fileID: fid,
      outputType: 1,
      minSheetColumnCount: 1,
      minSheetRowCount: 1,
    })
    const ir = await app.request("http://127.0.0.1/universer-api/exchange/2/import", {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8", ...projHdr },
      body: payload,
    })
    expect(ir.status).toBe(200)
    const imp = (await ir.json()) as { error: { code: number }; taskID: string }
    expect(imp.error.code).toBe(1)
    expect(imp.taskID.length).toBeGreaterThan(0)

    const tr = await app.request(`http://127.0.0.1/universer-api/exchange/task/${imp.taskID}`, {
      headers: { ...projHdr },
    })
    expect(tr.status).toBe(200)
    const task = (await tr.json()) as {
      error: { code: number }
      status: string
      import: { unitID: string }
    }
    expect(task.error.code).toBe(1)
    expect(task.status).toBe("done")
    expect(task.import.unitID.length).toBeGreaterThan(0)
  })

  test("snapshot create + save", async () => {
    const store = new Store(new MemoryExchangeFiles(), 1)
    const app = createCompatApp(store, auth)
    const cr = await app.request("http://127.0.0.1/universer-api/snapshot/2/unit/-/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...projHdr },
      body: JSON.stringify({ type: 2, name: "Sheet", creator: "user" }),
    })
    expect(cr.status).toBe(200)
    const created = (await cr.json()) as { unitID: string }
    expect(created.unitID.length).toBeGreaterThan(0)

    const sb = await app.request(`http://127.0.0.1/universer-api/snapshot/2/unit/${created.unitID}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...projHdr },
      body: JSON.stringify({
        baseRev: 0,
        memberID: "user",
        snapshot: { id: created.unitID, sheetOrder: [] },
      }),
    })
    expect(sb.status).toBe(200)
  })

  test("persisted unit hydrates after new Store (compat restart)", async () => {
    const mem = new MemoryExchangeFiles()
    const s0 = new Store(mem, 1)
    const app0 = createCompatApp(s0, auth)
    const cr = await app0.request("http://127.0.0.1/universer-api/snapshot/2/unit/-/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...projHdr },
      body: JSON.stringify({ type: 2, name: "Sheet", creator: "user" }),
    })
    expect(cr.status).toBe(200)
    const created = (await cr.json()) as { unitID: string }

    const sb = await app0.request(`http://127.0.0.1/universer-api/snapshot/2/unit/${created.unitID}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...projHdr },
      body: JSON.stringify({
        baseRev: 0,
        memberID: "user",
        snapshot: { id: created.unitID, sheetOrder: ["s1"], sheets: {} },
      }),
    })
    expect(sb.status).toBe(200)

    const s1 = new Store(mem, 1)
    const app1 = createCompatApp(s1, auth)
    const load = await app1.request(`http://127.0.0.1/universer-api/snapshot/2/unit/${created.unitID}/rev/0`, {
      headers: { ...projHdr },
    })
    expect(load.status).toBe(200)
    const body = (await load.json()) as { latestRevision?: number }
    expect(body.latestRevision).toBe(1)
  })

  test("formula license limit endpoints", async () => {
    const app = createCompatApp(new Store(new MemoryExchangeFiles(), 1), auth)
    const st = await app.request("http://127.0.0.1/universer-api/license/formula/limit/status")
    expect(st.status).toBe(200)
    const j = (await st.json()) as { limitInfo: { granted: boolean } }
    expect(j.limitInfo.granted).toBe(true)
  })
})

describe("optional remote compat URL", () => {
  test.skipIf(!process.env.EXCHANGE_COMPAT_TEST_URL)("health on remote", async () => {
    const root = process.env.EXCHANGE_COMPAT_TEST_URL!.replace(/\/$/, "")
    const r = await fetch(`${root}/readyz`)
    expect(r.ok).toBe(true)
  })
})
