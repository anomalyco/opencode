import { expect, test } from "bun:test"
import { Hono } from "hono"
import { basicAuth } from "hono/basic-auth"
import { createInternalFetch } from "../../src/cli/cmd/internal-fetch"

test("createInternalFetch adds basic auth when configured", async () => {
  let seenAuth: string | null = null
  const baseFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    seenAuth = req.headers.get("authorization")
    return Promise.resolve(new Response("ok"))
  }) as typeof globalThis.fetch

  const fetchWithAuth = createInternalFetch(baseFetch, {
    username: "opencode",
    password: "secret",
  })

  await fetchWithAuth("http://opencode.internal/health")
  if (seenAuth === null) throw new Error("authorization header was not set")
  const expected = `Basic ${Buffer.from("opencode:secret").toString("base64")}`
  if (seenAuth !== expected) throw new Error(`unexpected authorization header: ${seenAuth}`)
})

test("createInternalFetch preserves explicit authorization header", async () => {
  let seenAuth: string | null = null
  const baseFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    seenAuth = req.headers.get("authorization")
    return Promise.resolve(new Response("ok"))
  }) as typeof globalThis.fetch

  const fetchWithAuth = createInternalFetch(baseFetch, {
    username: "opencode",
    password: "secret",
  })

  await fetchWithAuth("http://opencode.internal/health", {
    headers: {
      Authorization: "Basic custom-token",
    },
  })

  if (seenAuth === null) throw new Error("authorization header was not preserved")
  if (seenAuth !== "Basic custom-token") throw new Error(`unexpected authorization header: ${seenAuth}`)
})

test("internal fetch can access basic-auth protected route when env auth is set", async () => {
  const app = new Hono()
    .use(
      "*",
      basicAuth({
        username: "opencode",
        password: "secret",
      }),
    )
    .get("/session", (c) => c.json({ ok: true }))

  const baseFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    return app.fetch(req)
  }) as typeof globalThis.fetch

  const unauth = await baseFetch("http://opencode.internal/session")
  expect(unauth.status).toBe(401)

  const fetchWithAuth = createInternalFetch(baseFetch, {
    username: "opencode",
    password: "secret",
  })
  const authed = await fetchWithAuth("http://opencode.internal/session")
  expect(authed.status).toBe(200)
  expect(await authed.json()).toEqual({ ok: true })
})
