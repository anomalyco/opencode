import { NodeHttpServer } from "@effect/platform-node"
import Http from "node:http"
import { describe, expect } from "bun:test"
import { Context, Effect, Layer, Queue } from "effect"
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { HttpApiProxy } from "../../src/server/routes/instance/httpapi/middleware/proxy"
import { testEffect } from "../lib/effect"

function serverUrl() {
  return HttpServer.HttpServer.use((server) => Effect.succeed(HttpServer.formatAddress(server.address)))
}

const testServerLayer = Layer.mergeAll(
  NodeHttpServer.layer(Http.createServer, { host: "127.0.0.1", port: 0 }),
  Socket.layerWebSocketConstructorGlobal,
)
const it = testEffect(testServerLayer)

type TestHandler<E, R> = (
  request: HttpServerRequest.HttpServerRequest,
) => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>

function listenServer<E, R>(handler: TestHandler<E, R>) {
  return Effect.gen(function* () {
    yield* HttpServer.serveEffect()(HttpServerRequest.HttpServerRequest.use(handler))
    return yield* serverUrl()
  })
}

function listenTestServer<E, R>(handler: TestHandler<E, R>) {
  return Effect.gen(function* () {
    // Build into the current test scope so the listener stays alive until the
    // test finishes. Using Effect.provide here would release it immediately.
    const context = yield* Layer.build(NodeHttpServer.layer(Http.createServer, { host: "127.0.0.1", port: 0 }))
    const server = Context.get(context, HttpServer.HttpServer)
    yield* server.serve(HttpServerRequest.HttpServerRequest.use(handler))
    return HttpServer.formatAddress(server.address)
  })
}

function echoWebSocket(request: HttpServerRequest.HttpServerRequest) {
  return Effect.gen(function* () {
    const socket = yield* Effect.orDie(request.upgrade)
    const write = yield* socket.writer
    // The upstream announces the negotiated protocol, then echoes every
    // received frame. The assertions use those messages to prove proxy flow.
    yield* socket
      .runRaw((message) => write(`echo:${String(message)}`), {
        onOpen: write(`protocol:${request.headers["sec-websocket-protocol"] ?? "none"}`).pipe(
          Effect.catch(() => Effect.void),
        ),
      })
      .pipe(Effect.catch(() => Effect.void))
    return HttpServerResponse.empty()
  })
}

describe("HttpApi workspace proxy", () => {
  it.live("proxies HTTP request and returns streamed response with status and headers", () =>
    Effect.gen(function* () {
      const url = yield* listenServer(
        Effect.fnUntraced(function* (req: HttpServerRequest.HttpServerRequest) {
          const body = yield* req.text
          return yield* HttpServerResponse.json(
            { path: req.url, method: req.method, body },
            {
              status: 201,
              headers: {
                "content-encoding": "identity",
                "content-length": "999",
                "x-remote": "yes",
              },
            },
          )
        }),
      )

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
      const url = yield* listenServer((req) =>
        Effect.sync(() => {
          forwarded = req.headers
          return HttpServerResponse.empty()
        }),
      )

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

  it.live("proxies websocket messages and protocols", () =>
    Effect.gen(function* () {
      const upstreamUrl = yield* listenTestServer(echoWebSocket)

      // Client -> proxy listener -> HttpApiProxy.websocket -> upstream listener.
      // The client never connects to upstream directly.
      const proxyUrl = yield* listenServer((request) => HttpApiProxy.websocket(request, `${upstreamUrl}/echo`))

      const socket = yield* Socket.makeWebSocket(`${proxyUrl.replace(/^http/, "ws")}/proxy`, {
        closeCodeIsError: () => false,
        protocols: "chat",
      })
      const messages = yield* Queue.unbounded<string>()
      yield* socket.runRaw((message) => Queue.offer(messages, String(message))).pipe(Effect.forkScoped)
      const write = yield* socket.writer

      expect(yield* Queue.take(messages)).toBe("protocol:chat")
      yield* write("hello")
      expect(yield* Queue.take(messages)).toBe("echo:hello")
    }),
  )
})
