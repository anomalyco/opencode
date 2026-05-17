import { expect } from "bun:test"
import type { Hono } from "hono"

/** Authenticated universer presign + PUT (memory or real S3), returns `FileId`. */
export async function exchangePresignPut(
  app: Hono,
  buf: Uint8Array,
  contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
) {
  const pr = await app.request("http://127.0.0.1/universer-api/stream/file/presign-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ size: buf.byteLength, contentType }),
  })
  expect(pr.status).toBe(200)
  const j = (await pr.json()) as { FileId?: string; uploadUrl?: string; headers?: Record<string, string> }
  const fid = j.FileId
  const uploadUrl = j.uploadUrl
  if (!fid || !uploadUrl) throw new Error("presign response missing FileId or uploadUrl")
  const hdrs = j.headers
  if (uploadUrl.includes("/_memory_exchange_put/")) {
    const put = await app.request(uploadUrl, {
      method: "PUT",
      headers: hdrs,
      body: Buffer.from(buf),
    })
    expect(put.status).toBeGreaterThanOrEqual(200)
    expect(put.status).toBeLessThan(300)
    return fid
  }
  const put = await fetch(uploadUrl, { method: "PUT", headers: hdrs, body: Buffer.from(buf) })
  expect(put.ok).toBe(true)
  return fid
}
