import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Context, Effect, Layer, Queue } from "effect"
import { Socket } from "effect/unstable/socket"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http"
import { basePathServer } from "../../src/server/base-path"
import { HttpApiProxy } from "../../src/server/routes/instance/httpapi/middleware/proxy"
import { injectBasePath } from "../../src/server/shared/ui"
import { testEffect } from "../lib/effect"

const prefix = "/nested/proxy/service"
const it = testEffect(Layer.mergeAll(NodeHttpServer.layerTest, Socket.layerWebSocketConstructorGlobal))

for (const stripped of [false, true]) {
  describe(`base path through proxy (stripped=${stripped})`, () => {
    it.live("forwards HTTP bodies, auth, queries, HTML and WebSocket frames", () =>
      Effect.gen(function* () {
        const context = yield* Layer.build(
          NodeHttpServer.layer(() => basePathServer({ basePath: prefix, basePathStripped: stripped }), {
            host: "127.0.0.1",
            port: 0,
          }),
        )
        const backend = Context.get(context, HttpServer.HttpServer)
        yield* backend.serve(
          HttpServerRequest.HttpServerRequest.use((request) =>
            Effect.gen(function* () {
              if (request.url.startsWith("/api/pty/")) {
                const socket = yield* request.upgrade
                const write = yield* socket.writer
                yield* socket
                  .runRaw((message) => write(`${request.url}:${String(message)}`))
                  .pipe(Effect.catch(() => Effect.void))
                return HttpServerResponse.empty()
              }
              if (request.url.startsWith("/project/session/"))
                return HttpServerResponse.html(
                  injectBasePath('<html><head><script src="./assets/app.js"></script></head></html>', prefix),
                )
              return HttpServerResponse.jsonUnsafe({
                path: request.url,
                method: request.method,
                authorization: request.headers.authorization,
                body: yield* request.text,
              })
            }),
          ),
        )
        const upstream = HttpServer.formatAddress(backend.address)
        const client = yield* HttpClient.HttpClient
        const upstreamClient = yield* Effect.provide(HttpClient.HttpClient, FetchHttpClient.layer)
        // A reverse proxy can strip the entire configured prefix before forwarding.
        yield* HttpServer.serveEffect()(
          HttpServerRequest.HttpServerRequest.use((request) => {
            const path = stripped ? request.url.slice(prefix.length) : request.url
            if (request.headers.upgrade === "websocket") return HttpApiProxy.websocket(request, upstream + path)
            return HttpApiProxy.http(upstreamClient, upstream + path, {}, request)
          }),
        )

        const response = yield* client.execute(
          HttpClientRequest.post(prefix + "/api/echo?q=a?b&value=%2F", {
            headers: { authorization: "Bearer test" },
          }).pipe(HttpClientRequest.bodyText("payload")),
        )
        expect(response.status).toBe(200)
        expect(yield* response.json).toEqual({
          path: "/api/echo?q=a?b&value=%2F",
          method: "POST",
          authorization: "Bearer test",
          body: "payload",
        })
        const html = yield* client.get(prefix + "/project/session/test").pipe(Effect.flatMap((r) => r.text))
        expect(html).toContain(`<base href="${prefix}/">`)
        expect(html).toContain(`window.__OPENCODE_BASE_PATH__="${prefix}"`)

        const server = yield* HttpServer.HttpServer
        const socket = yield* Socket.makeWebSocket(
          HttpServer.formatAddress(server.address).replace(/^http/, "ws") + prefix + "/api/pty/test/connect?ticket=abc",
          { closeCodeIsError: () => false },
        )
        const messages = yield* Queue.unbounded<string>()
        yield* socket.runRaw((message) => Queue.offer(messages, String(message))).pipe(Effect.forkScoped)
        const write = yield* socket.writer
        yield* write("hello")
        expect(yield* Queue.take(messages)).toBe("/api/pty/test/connect?ticket=abc:hello")
      }).pipe(Effect.timeout("10 seconds")),
    )
  })
}

it.live("redirects only the exact prefix and preserves the entire query and POST method", () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      NodeHttpServer.layer(() => basePathServer({ basePath: prefix }), {
        host: "127.0.0.1",
        port: 0,
      }),
    )
    const server = Context.get(context, HttpServer.HttpServer)
    yield* server.serve(Effect.succeed(HttpServerResponse.text("ok")))
    const client = yield* Effect.provide(
      HttpClient.HttpClient,
      FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.RequestInit)({ redirect: "manual" }))),
    )
    const url = HttpServer.formatAddress(server.address)
    const response = yield* client.post(url + prefix + "?next=a?b&value=%2F")
    expect(response.status).toBe(308)
    expect(response.headers.location).toBe(prefix + "/?next=a?b&value=%2F")
    expect((yield* client.get(url + prefix + "-other/api/health")).status).toBe(404)
    expect((yield* client.get(url + "/api/health")).status).toBe(404)
  }),
)
