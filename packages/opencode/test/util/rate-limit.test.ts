import { afterEach, describe, expect, test } from "bun:test"
import { Hono } from "hono"

const SSE_PATHS = new Set(["/event", "/global/event"])
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 3

function cleanupRateLimitBuckets() {
  const now = Date.now()
  for (const [key, bucket] of rateLimitBuckets) {
    if (now > bucket.resetAt) rateLimitBuckets.delete(key)
  }
}

afterEach(() => {
  rateLimitBuckets.clear()
})

const rateLimitMiddleware: import("hono").MiddlewareHandler = async (c, next) => {
  if (SSE_PATHS.has(c.req.path)) return next()
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown"
  const key = `${ip}:${c.req.path}`
  const now = Date.now()
  let bucket = rateLimitBuckets.get(key)
  if (!bucket || now > bucket.resetAt) {
    cleanupRateLimitBuckets()
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
    rateLimitBuckets.set(key, bucket)
  }
  bucket.count++
  if (bucket.count > RATE_LIMIT_MAX) {
    return c.json({ error: "Too many requests" }, { status: 429 })
  }
  return next()
}

function req(path: string, ip: string) {
  return new Request(`http://localhost${path}`, { headers: { "x-real-ip": ip } })
}

function reqXff(path: string, xff: string) {
  return new Request(`http://localhost${path}`, { headers: { "x-forwarded-for": xff } })
}

describe("RateLimitMiddleware", () => {
  test("allows requests within limit", async () => {
    const app = new Hono().use(rateLimitMiddleware).get("/test", (c) => c.json({ ok: true }))

    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      const res = await app.request(req("/test", "1.2.3.4"))
      expect(res.status).toBe(200)
    }
  })

  test("blocks requests exceeding limit", async () => {
    const app = new Hono().use(rateLimitMiddleware).get("/test", (c) => c.json({ ok: true }))

    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      await app.request(req("/test", "5.6.7.8"))
    }

    const res = await app.request(req("/test", "5.6.7.8"))
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toBe("Too many requests")
  })

  test("tracks limits per IP", async () => {
    const app = new Hono().use(rateLimitMiddleware).get("/per-ip-test", (c) => c.json({ ok: true }))

    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      const res = await app.request(req("/per-ip-test", "172.16.0.1"))
      expect(res.status).toBe(200)
    }

    // Same IP should be blocked
    const blocked = await app.request(req("/per-ip-test", "172.16.0.1"))
    expect(blocked.status).toBe(429)

    // Different IP should still be allowed
    const res = await app.request(req("/per-ip-test", "172.16.0.2"))
    expect(res.status).toBe(200)
  })

  test("exempts SSE paths", async () => {
    const app = new Hono().use(rateLimitMiddleware).get("/event", (c) => c.json({ ok: true }))

    for (let i = 0; i < RATE_LIMIT_MAX + 5; i++) {
      const res = await app.request(req("/event", "1.1.1.1"))
      expect(res.status).toBe(200)
    }
  })

  test("uses x-forwarded-for header", async () => {
    const app = new Hono().use(rateLimitMiddleware).get("/xff-test", (c) => c.json({ ok: true }))

    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      await app.request(reqXff("/xff-test", "20.0.0.1, 10.0.0.1"))
    }

    const res = await app.request(reqXff("/xff-test", "20.0.0.1, 10.0.0.1"))
    expect(res.status).toBe(429)
  })
})
