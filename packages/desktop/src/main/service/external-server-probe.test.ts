import { describe, expect, test } from "bun:test"

import { probe } from "./external-server-probe"

// Readiness is exactly HTTP 200 from GET /api/info. Everything else (401/403/404, refused, DNS,
// timeout) keeps the desktop waiting, so each non-200 case is pinned here.

describe("external server readiness probe", () => {
  test("HTTP 200 is ready", async () => {
    await withServer(() => new Response("ok", { status: 200 }), async (url) => {
      expect(await probe(url, null)).toEqual({ ready: true })
    })
  })

  test("HTTP 401 is not ready", async () => {
    await withServer(() => new Response("unauthorized", { status: 401 }), async (url) => {
      expect(await probe(url, "wrong")).toEqual({ ready: false, reason: "HTTP 401" })
    })
  })

  test("HTTP 403 and 404 are not ready", async () => {
    await withServer(() => new Response("forbidden", { status: 403 }), async (url) => {
      expect(await probe(url, null)).toEqual({ ready: false, reason: "HTTP 403" })
    })
    await withServer(() => new Response("missing", { status: 404 }), async (url) => {
      expect(await probe(url, null)).toEqual({ ready: false, reason: "HTTP 404" })
    })
  })

  test("a refused connection is not ready", async () => {
    // Bind, capture the port, then release it so the origin is definitely refusing.
    const server = Bun.serve({ port: 0, fetch: () => new Response("ok", { status: 200 }) })
    const url = origin(server)
    await server.stop(true)

    expect((await probe(url, null, 1_000)).ready).toBe(false)
  })

  test("a hung connection times out as not ready", async () => {
    await withServer(
      () => new Promise<Response>(() => {}),
      async (url) => {
        expect((await probe(url, null, 50)).ready).toBe(false)
      },
    )
  })

  test("sends Basic credentials only when a password is configured", async () => {
    const seen: Array<string | null> = []
    await withServer(
      (request) => {
        seen.push(request.headers.get("authorization"))
        return new Response("ok", { status: 200 })
      },
      async (url) => {
        await probe(url, "secret")
        await probe(url, null)
        await probe(url, "")
      },
    )

    expect(seen[0]).toBe(`Basic ${Buffer.from("opencode:secret").toString("base64")}`)
    expect(seen[1]).toBeNull()
    expect(seen[2]).toBeNull()
  })
})

async function withServer(
  handler: (request: Request) => Response | Promise<Response>,
  run: (url: string) => Promise<void>,
) {
  const server = Bun.serve({ port: 0, fetch: handler })
  try {
    await run(origin(server))
  } finally {
    await server.stop(true)
  }
}

function origin(server: ReturnType<typeof Bun.serve>) {
  return `http://127.0.0.1:${server.port}`
}
