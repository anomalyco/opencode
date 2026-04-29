import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiProxy } from "../../src/server/routes/instance/httpapi/middleware/proxy"
import { it } from "../lib/effect"

function startRemote(handler: (req: Request) => Response | Promise<Response>) {
  return Bun.serve({ port: 0, fetch: handler })
}

describe("HttpApi workspace proxy", () => {
  it.live("proxies HTTP request and returns streamed response with status and headers", () =>
    Effect.gen(function* () {
      const remote = startRemote((req) => {
        const url = new URL(req.url)
        return new Response(JSON.stringify({ path: url.pathname, method: req.method }), {
          status: 201,
          headers: { "content-type": "application/json", "x-remote": "yes" },
        })
      })

      try {
        const request = HttpServerRequest.fromWeb(
          new Request("http://localhost/session/abc", { method: "POST", body: "{}" }),
        )
        const response = yield* HttpApiProxy.http(
          `http://127.0.0.1:${remote.port}/session/abc`,
          { "x-extra": "injected" },
          request,
        )

        expect(response.status).toBe(201)
        const client = HttpServerResponse.toClientResponse(response)
        expect(yield* client.json).toEqual({ path: "/session/abc", method: "POST" })
        expect((response.headers as Record<string, string>)["x-remote"]).toBe("yes")
      } finally {
        remote.stop(true)
      }
    }),
  )

  it.live("returns 500 when remote is unreachable", () =>
    Effect.gen(function* () {
      const request = HttpServerRequest.fromWeb(new Request("http://localhost/anything"))
      const response = yield* HttpApiProxy.http("http://127.0.0.1:1/unreachable", undefined, request)

      expect(response.status).toBe(500)
    }),
  )

  it.live("strips hop-by-hop and opencode headers from forwarded request", () =>
    Effect.gen(function* () {
      let forwarded: Record<string, string> = {}
      const remote = startRemote((req) => {
        forwarded = Object.fromEntries(req.headers.entries())
        return new Response("ok")
      })

      try {
        const request = HttpServerRequest.fromWeb(
          new Request("http://localhost/test", {
            headers: {
              connection: "keep-alive",
              "x-opencode-directory": "/secret/path",
              "x-opencode-workspace": "ws_123",
              "accept-encoding": "gzip",
              "x-custom": "preserved",
            },
          }),
        )
        yield* HttpApiProxy.http(`http://127.0.0.1:${remote.port}/test`, { "x-injected": "extra" }, request)

        // connection/accept-encoding are re-added by the transport layer,
        // but opencode-internal headers must not leak to the upstream
        expect(forwarded["x-opencode-directory"]).toBeUndefined()
        expect(forwarded["x-opencode-workspace"]).toBeUndefined()
        expect(forwarded["x-custom"]).toBe("preserved")
        expect(forwarded["x-injected"]).toBe("extra")
      } finally {
        remote.stop(true)
      }
    }),
  )
})
