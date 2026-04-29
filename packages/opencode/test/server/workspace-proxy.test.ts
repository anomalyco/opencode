import { NodeHttpServer } from "@effect/platform-node"
import Http from "node:http"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiProxy } from "../../src/server/routes/instance/httpapi/middleware/proxy"
import { testEffect } from "../lib/effect"

function serverUrl() {
  return Effect.gen(function* () {
    return HttpServer.formatAddress((yield* HttpServer.HttpServer).address)
  })
}

const testServerLayer = NodeHttpServer.layer(Http.createServer, { host: "127.0.0.1", port: 0 })
const it = testEffect(testServerLayer)

describe("HttpApi workspace proxy", () => {
  it.live("proxies HTTP request and returns streamed response with status and headers", () =>
    Effect.gen(function* () {
      yield* HttpServer.serveEffect()(
        Effect.gen(function* () {
          const req = yield* HttpServerRequest.HttpServerRequest
          const body = yield* req.text
          return yield* HttpServerResponse.json({ path: req.url, method: req.method, body }, {
            status: 201,
            headers: {
              "content-encoding": "identity",
              "content-length": "999",
              "x-remote": "yes",
            },
          })
        }),
      )
      const url = yield* serverUrl()

      const request = HttpServerRequest.fromWeb(
        new Request("http://localhost/session/abc", { method: "POST", body: "request-body" }),
      )
      const response = yield* HttpApiProxy.http(`${url}/session/abc?keep=yes`, { "x-extra": "injected" }, request)

      expect(response.status).toBe(201)
      const client = HttpServerResponse.toClientResponse(response)
      expect(yield* client.json).toEqual({
        path: "/session/abc?keep=yes",
        method: "POST",
        body: "request-body",
      })
      expect(response.headers["x-remote"]).toBe("yes")
      expect(response.headers["content-encoding"]).toBeUndefined()
      expect(response.headers["content-length"]).toBeUndefined()
    }),
  )

  it.live("returns 500 when remote is unreachable", () =>
    Effect.gen(function* () {
      const request = HttpServerRequest.fromWeb(new Request("http://localhost/anything"))
      const response = yield* HttpApiProxy.http("http://127.0.0.1:1/unreachable", undefined, request)

      expect(response.status).toBe(500)
    }),
  )

  it.live("strips opencode-internal headers and merges extra headers", () =>
    Effect.gen(function* () {
      let forwarded: Record<string, string> = {}
      yield* HttpServer.serveEffect()(
        Effect.gen(function* () {
          const req = yield* HttpServerRequest.HttpServerRequest
          forwarded = req.headers
          return HttpServerResponse.empty()
        }),
      )
      const url = yield* serverUrl()

      const request = HttpServerRequest.fromWeb(
        new Request("http://localhost/test", {
          headers: {
            "x-opencode-directory": "/secret/path",
            "x-opencode-workspace": "ws_123",
            "x-custom": "preserved",
          },
        }),
      )
      yield* HttpApiProxy.http(`${url}/test`, { "x-injected": "extra" }, request)

      expect(forwarded["x-opencode-directory"]).toBeUndefined()
      expect(forwarded["x-opencode-workspace"]).toBeUndefined()
      expect(forwarded["x-custom"]).toBe("preserved")
      expect(forwarded["x-injected"]).toBe("extra")
    }),
  )
})
