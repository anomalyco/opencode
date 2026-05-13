import type { Context } from "hono"

export async function readRawBody(c: Context, max = 32 << 20) {
  const buf = await c.req.raw.arrayBuffer()
  if (buf.byteLength > max) return undefined
  return Buffer.from(buf)
}

export function jsonResponse(v: unknown, status = 200) {
  return new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  })
}
