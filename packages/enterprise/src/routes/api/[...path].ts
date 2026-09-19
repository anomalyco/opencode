import type { APIEvent } from "@solidjs/start/server"
import { Hono } from "hono"
import type { Context } from "hono"
import { describeRoute, openAPIRouteHandler, resolver } from "hono-openapi"
import { validator } from "hono-openapi"
import z from "zod"
import { cors } from "hono/cors"
import { Share } from "~/core/share"
import { Resource } from "sst"
import { timingSafeEqual } from "node:crypto"

const MAX_BODY_BYTES = 8 * 1024 * 1024

// Share URLs use the configured public origin when present. Behind a proxy or TLS
// terminator the request `host` is the internal address, so deployments must set
// OPENCODE_SHARE_PUBLIC_URL; the host fallback is validated and relative otherwise
// rather than trusting client-controlled forwarded headers (DRIFT-4).
const HOST = /^[A-Za-z0-9.-]+(?::[0-9]+)?$/

function shareURL(c: Context, shareID: string) {
  const configured = process.env.OPENCODE_SHARE_PUBLIC_URL
  if (configured) return `${configured.replace(/\/+$/, "")}/share/${shareID}`
  const host = c.req.header("host")
  if (!host || !HOST.test(host)) return `/share/${shareID}`
  return `https://${host}/share/${shareID}`
}

// `content-length` is optional and absent on chunked/HTTP-2 requests (O2-26/D2-03), so
// the cap must be enforced on the bytes actually read. Reading the raw stream here also
// avoids Hono buffering an oversized body before validation.
async function readBodyWithin(c: Context, limit: number) {
  const body = c.req.raw.body
  if (!body) return new Uint8Array()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) {
        await reader.cancel()
        return undefined
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

async function jsonBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | Response> {
  const raw = await readBodyWithin(c, MAX_BODY_BYTES)
  if (!raw) return c.json({ error: "Payload too large" }, 413)
  let parsed: unknown
  try {
    parsed = raw.byteLength === 0 ? undefined : JSON.parse(new TextDecoder().decode(raw))
  } catch {
    parsed = undefined
  }
  const result = schema.safeParse(parsed)
  if (!result.success) return c.json({ error: "Invalid request", issues: result.error.issues }, 400)
  return result.data
}

const RATE_WINDOW_MS = 60_000
const RATE_LIMITS: { match: (method: string, path: string) => boolean; limit: number }[] = [
  { match: (method, path) => method === "POST" && path.endsWith("/share"), limit: 10 },
  { match: (method, path) => method === "POST" && path.endsWith("/sync"), limit: 120 },
  { match: (method, path) => method === "GET" && path.endsWith("/data"), limit: 240 },
]

const rateWindows = new Map<string, { count: number; reset: number }>()
const RATE_WINDOW_MAX = 10_000

function clientKey(c: Context) {
  // `cf-connecting-ip` is set by the edge and cannot be rotated by the caller.
  // `x-real-ip` / `x-forwarded-for` are client-controlled, so trusting them lets one
  // caller mint unlimited rate-limit keys. Headerless clients share one bucket.
  return c.req.header("cf-connecting-ip") ?? "unknown"
}

function rateLimited(c: Context) {
  const rule = RATE_LIMITS.find((entry) => entry.match(c.req.method, c.req.path))
  if (!rule) return false
  const now = Date.now()
  if (rateWindows.size > RATE_WINDOW_MAX) {
    for (const [key, window] of rateWindows) {
      if (window.reset <= now) rateWindows.delete(key)
    }
    while (rateWindows.size > RATE_WINDOW_MAX) {
      const oldest = rateWindows.keys().next()
      if (oldest.done) break
      rateWindows.delete(oldest.value)
    }
  }
  const key = `${rule.limit}:${clientKey(c)}`
  const window = rateWindows.get(key)
  if (!window || window.reset <= now) {
    rateWindows.set(key, { count: 1, reset: now + RATE_WINDOW_MS })
    return false
  }
  if (window.count >= rule.limit) return true
  window.count += 1
  return false
}

const app = new Hono()

app
  .basePath("/api")
  .use(cors())
  .use(async (c, next) => {
    if (rateLimited(c)) return c.json({ error: "Too many requests" }, 429)
    await next()
  })
  .get(
    "/doc",
    openAPIRouteHandler(app, {
      documentation: {
        info: {
          title: "Opencode Enterprise API",
          version: "1.0.0",
          description: "Opencode Enterprise API endpoints",
        },
        openapi: "3.1.1",
      },
    }),
  )
  .post(
    "/share",
    describeRoute({
      description: "Create a share",
      operationId: "share.create",
      responses: {
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(
                z
                  .object({
                    id: z.string(),
                    url: z.string(),
                    secret: z.string(),
                  })
                  .meta({ ref: "Share" }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const body = await jsonBody(c, z.object({ sessionID: Share.SessionID }))
      if (body instanceof Response) return body
      const share = await Share.create({ sessionID: body.sessionID })
      return c.json({
        id: share.id,
        secret: share.secret,
        url: shareURL(c, share.id),
      })
    },
  )
  .post(
    "/share/:shareID/sync",
    describeRoute({
      description: "Sync share data",
      operationId: "share.sync",
      responses: {
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.object({})),
            },
          },
        },
      },
    }),
    validator("param", z.object({ shareID: Share.ShareID })),
    async (c) => {
      const { shareID } = c.req.valid("param")
      const body = await jsonBody(
        c,
        z.object({ secret: z.string(), data: Share.Data.array().max(Share.MAX_SYNC_ITEMS) }),
      )
      if (body instanceof Response) return body
      await Share.sync({
        share: { id: shareID, secret: body.secret },
        data: body.data,
      })
      return c.json({})
    },
  )
  .get(
    "/share/:shareID/data",
    describeRoute({
      description: "Get share data",
      operationId: "share.data",
      responses: {
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.array(Share.Data)),
            },
          },
        },
      },
    }),
    validator("param", z.object({ shareID: Share.ShareID })),
    async (c) => {
      const { shareID } = c.req.valid("param")
      c.header("Cache-Control", "public, max-age=30, s-maxage=300, stale-while-revalidate=86400")
      return c.json(await Share.data(shareID))
    },
  )
  .delete(
    "/share/:shareID",
    describeRoute({
      description: "Remove a share",
      operationId: "share.remove",
      responses: {
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.object({})),
            },
          },
        },
      },
    }),
    validator("param", z.object({ shareID: Share.ShareID })),
    async (c) => {
      const { shareID } = c.req.valid("param")
      const body = await jsonBody(c, z.object({ secret: z.string() }))
      if (body instanceof Response) return body
      await Share.remove({ id: shareID, secret: body.secret })
      return c.json({})
    },
  )
  .delete("/support/actions/remove-share", async (c) => {
    const authorization = c.req.header("authorization")
    const expected = `Bearer ${(Resource as unknown as Record<string, { value: string }>).SUPPORT_API_KEY.value}`
    const actual = Buffer.from(authorization ?? "")
    const secret = Buffer.from(expected)
    if (actual.length !== secret.length || !timingSafeEqual(actual, secret))
      return c.json({ error: "Unauthorized" }, 401)

    const body = await jsonBody(c, z.object({ shareID: Share.ShareID }))
    if (body instanceof Response) return body
    return Share.removeAdmin({ id: body.shareID })
      .then(() => c.json({ success: true, message: "Share removed" }))
      .catch((error) => c.json({ error: error instanceof Error ? error.message : String(error) }, 400))
  })

app.onError((error, c) => {
  if (error instanceof Share.Errors.NotFound) return c.json({ error: "Not found" }, 404)
  if (error instanceof Share.Errors.InvalidSecret) return c.json({ error: "Forbidden" }, 403)
  if (error instanceof Share.Errors.AlreadyExists) return c.json({ error: "Conflict" }, 409)
  console.error(error)
  return c.json({ error: "Internal server error" }, 500)
})

export function GET(event: APIEvent) {
  return app.fetch(event.request)
}

export function POST(event: APIEvent) {
  return app.fetch(event.request)
}

export function PUT(event: APIEvent) {
  return app.fetch(event.request)
}

export async function DELETE(event: APIEvent) {
  return app.fetch(event.request)
}
