import { describe, expect, test } from "bun:test"
import * as XLSX from "xlsx"
import { headerSessionResolver } from "@veritly/auth-shared"
import { createCompatApp } from "../src/app"
import { assertSafeUserSegment } from "../src/object-keys"
import { MemoryExchangeFiles } from "../src/memory-exchange-files"
import { Store } from "../src/store"

/** In-memory presign isolation only — not the Playwright / Docker WorkOS path (see app e2e). */
const tenantHdr = "x-e2e-univer-tenant"
const testTenantResolver = headerSessionResolver(tenantHdr, assertSafeUserSegment)

const isoProj = "iso-p1"

function hdr(user: string) {
  return { [tenantHdr]: user, "x-veritly-project-id": isoProj }
}

function minimalXlsx() {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([["cell"]])
  XLSX.utils.book_append_sheet(wb, ws, "S1")
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }))
}

const ct = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

async function presignJson(app: ReturnType<typeof createCompatApp>, user: string, size: number) {
  return app.request("http://127.0.0.1/universer-api/stream/file/presign-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...hdr(user) },
    body: JSON.stringify({ size, contentType: ct }),
  })
}

async function putPresigned(
  app: ReturnType<typeof createCompatApp>,
  user: string,
  uploadUrl: string,
  headers: Record<string, string> | undefined,
  buf: Uint8Array,
) {
  const h = { ...headers }
  if (uploadUrl.includes("/_memory_exchange_put/")) {
    return app.request(uploadUrl, {
      method: "PUT",
      headers: { ...h, ...hdr(user) },
      body: Buffer.from(buf),
    })
  }
  return fetch(uploadUrl, { method: "PUT", headers: h, body: Buffer.from(buf) })
}

describe("presign + in-memory per-request tenant (auth-shared headerSessionResolver)", () => {
  test("missing identity header → 401 on presign-upload", async () => {
    const app = createCompatApp(new Store(new MemoryExchangeFiles(), 1), testTenantResolver)
    const r = await app.request("http://127.0.0.1/universer-api/stream/file/presign-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-veritly-project-id": isoProj },
      body: JSON.stringify({ size: 10, contentType: ct }),
    })
    expect(r.status).toBe(401)
  })

  test("invalid user segment in header → 400", async () => {
    const app = createCompatApp(new Store(new MemoryExchangeFiles(), 1), testTenantResolver)
    const r = await presignJson(app, "evil/user", 10)
    expect(r.status).toBe(400)
  })

  test("user-a presign + PUT + import; user-b cannot import a's fileId", async () => {
    const app = createCompatApp(new Store(new MemoryExchangeFiles(), 1), testTenantResolver)
    const buf = minimalXlsx()
    const pr = await presignJson(app, "tenant-alpha", buf.byteLength)
    expect(pr.status).toBe(200)
    const p = (await pr.json()) as { FileId?: string; uploadUrl?: string; headers?: Record<string, string> }
    const put = await putPresigned(app, "tenant-alpha", p.uploadUrl!, p.headers, buf)
    expect(put.status).toBeGreaterThanOrEqual(200)
    expect(put.status).toBeLessThan(300)

    const irB = await app.request("http://127.0.0.1/universer-api/exchange/2/import", {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8", ...hdr("tenant-bravo") },
      body: JSON.stringify({
        fileID: p.FileId,
        outputType: 1,
        minSheetColumnCount: 1,
        minSheetRowCount: 1,
      }),
    })
    expect(irB.status).toBe(404)
  })

  test("user-b presign-upload succeeds; sign-url for a's file 404 for b", async () => {
    const app = createCompatApp(new Store(new MemoryExchangeFiles(), 1), testTenantResolver)
    const buf = minimalXlsx()
    const prA = await presignJson(app, "tenant-alpha", buf.byteLength)
    const a = (await prA.json()) as { FileId: string; uploadUrl: string; headers?: Record<string, string> }
    const putA = await putPresigned(app, "tenant-alpha", a.uploadUrl, a.headers, buf)
    expect(putA.status).toBeGreaterThanOrEqual(200)
    expect(putA.status).toBeLessThan(300)

    const prB = await presignJson(app, "tenant-bravo", buf.byteLength)
    expect(prB.status).toBe(200)

    const sign = await app.request(`http://127.0.0.1/universer-api/file/${a.FileId}/sign-url`, {
      headers: hdr("tenant-bravo"),
    })
    expect(sign.status).toBe(404)
  })

  test("memory PUT route rejects wrong user header (token scoped to minting user)", async () => {
    const app = createCompatApp(new Store(new MemoryExchangeFiles(), 1), testTenantResolver)
    const buf = minimalXlsx()
    const pr = await presignJson(app, "tenant-alpha", buf.byteLength)
    const j = (await pr.json()) as { uploadUrl: string; headers?: Record<string, string> }
    const bad = await app.request(j.uploadUrl, {
      method: "PUT",
      headers: { ...j.headers, ...hdr("tenant-bravo") },
      body: Buffer.from(buf),
    })
    expect(bad.status).toBe(400)
  })
})
