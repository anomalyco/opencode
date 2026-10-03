import { describe, expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials, createApiForServer } from "./server"

describe("authFromToken", () => {
  test("decodes basic auth credentials from auth_token", () => {
    expect(authFromToken(btoa("kit:secret"))).toEqual({ username: "kit", password: "secret" })
  })

  test("defaults blank username to opencode", () => {
    expect(authFromToken(btoa(":secret"))).toEqual({ username: "opencode", password: "secret" })
  })

  test("ignores malformed tokens", () => {
    expect(authFromToken("not base64")).toBeUndefined()
    expect(authFromToken(btoa("missing-separator"))).toBeUndefined()
  })
})

describe("authTokenFromCredentials", () => {
  test("encodes credentials with the default username", () => {
    expect(authTokenFromCredentials({ password: "secret" })).toBe(btoa("opencode:secret"))
  })
})

test("the vendored web client keeps the public prefix for HTTP and SSE", async () => {
  const paths: string[] = []
  const client = createApiForServer({
    server: { url: "https://example.com/nested/proxy/service/", password: "secret" },
    fetch: Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input)
        paths.push(url.pathname)
        expect(new Headers(init?.headers).get("authorization")).toBe("Basic " + btoa("opencode:secret"))
        if (url.pathname.endsWith("/api/health")) return Response.json({ healthy: true, version: "test", pid: 1 })
        return new Response('data: {"id":"evt_test","type":"server.connected","data":{}}\n\n', {
          headers: { "content-type": "text/event-stream" },
        })
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  })
  expect((await client.health.get()).healthy).toBe(true)
  const events = client.event.subscribe()[Symbol.asyncIterator]()
  try {
    expect((await events.next()).value?.type).toBe("server.connected")
  } finally {
    await events.return?.()
  }
  expect(paths).toEqual(["/nested/proxy/service/api/health", "/nested/proxy/service/api/event"])
})
