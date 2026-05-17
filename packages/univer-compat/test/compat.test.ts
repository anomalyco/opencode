import { auth } from "./setup-compat-auth"
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
      headers: { "Content-Type": "application/json;charset=UTF-8" },
      body: payload,
    })
    expect(ir.status).toBe(200)
    const imp = (await ir.json()) as { error: { code: number }; taskID: string }
    expect(imp.error.code).toBe(1)
    expect(imp.taskID.length).toBeGreaterThan(0)

    const tr = await app.request(`http://127.0.0.1/universer-api/exchange/task/${imp.taskID}`)
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: 2, name: "Sheet", creator: "user" }),
    })
    expect(cr.status).toBe(200)
    const created = (await cr.json()) as { unitID: string }
    expect(created.unitID.length).toBeGreaterThan(0)

    const sb = await app.request(`http://127.0.0.1/universer-api/snapshot/2/unit/${created.unitID}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: 2, name: "Sheet", creator: "user" }),
    })
    expect(cr.status).toBe(200)
    const created = (await cr.json()) as { unitID: string }

    const sb = await app0.request(`http://127.0.0.1/universer-api/snapshot/2/unit/${created.unitID}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseRev: 0,
        memberID: "user",
        snapshot: { id: created.unitID, sheetOrder: ["s1"], sheets: {} },
      }),
    })
    expect(sb.status).toBe(200)

    const s1 = new Store(mem, 1)
    const app1 = createCompatApp(s1, auth)
    const load = await app1.request(`http://127.0.0.1/universer-api/snapshot/2/unit/${created.unitID}/rev/0`)
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
    const r = await fetch(`${root}/healthz`)
    expect(r.ok).toBe(true)
  })
})
