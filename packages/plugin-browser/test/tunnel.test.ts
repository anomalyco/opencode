import { expect } from "bun:test"
import { createServer } from "node:net"
import { Server, request } from "node:http"
import { once } from "node:events"
import { NodeHttpServer, NodeSocket } from "@effect/platform-node"
import { Effect } from "effect"
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http"
import { Socket } from "effect/socket"
import { it } from "../../core/test/lib/effect"
import { Browser } from "../src/rpc.js"
import { BrowserTunnel } from "../src/tunnel.js"
import { BrowserProxy } from "../src/proxy.js"
import { BrowserStream } from "../src/stream.js"

it.live("binary WebSocket relay preserves bytes larger than its window and TCP half-close", () =>
  Effect.gen(function* () {
    const target = createServer({ allowHalfOpen: true }, (socket) => {
      const chunks: Buffer[] = []
      socket.on("data", (chunk) => chunks.push(chunk))
      socket.on("end", () => socket.end(Buffer.concat(chunks)))
    })
    yield* Effect.promise(() => once(target.listen(0, "127.0.0.1"), "listening"))
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => new Promise<void>((resolve) => target.close(() => resolve()))),
    )
    const address = target.address()
    if (!address || typeof address === "string") throw new Error("No TCP address")
    const fixture = yield* serve({ host: "127.0.0.1", port: address.port })
    const tunnel = yield* fixture.open
    const bytes = Buffer.alloc(BrowserStream.WINDOW_BYTES * 3 + 17, 203)
    const received = yield* Effect.promise(async () => {
      const chunks: Buffer[] = []
      const done = new Promise<Buffer>((resolve, reject) => {
        tunnel.stream.on("data", (chunk) => chunks.push(chunk))
        tunnel.stream.once("end", () => resolve(Buffer.concat(chunks)))
        tunnel.stream.once("error", reject)
      })
      tunnel.stream.end(bytes)
      return done
    })
    expect(received).toEqual(bytes)
    yield* tunnel.closed
  }),
)

for (const reason of ["attachment", "signal"] as const) {
  it.live(`${reason} cancellation closes the scoped WebSocket stream`, () =>
    Effect.gen(function* () {
      const target = createServer((socket) => socket.on("error", () => socket.destroy()))
      yield* Effect.promise(() => once(target.listen(0, "127.0.0.1"), "listening"))
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => new Promise<void>((resolve) => target.close(() => resolve()))),
      )
      const address = target.address()
      if (!address || typeof address === "string") throw new Error("No TCP address")
      const fixture = yield* serve({ host: "127.0.0.1", port: address.port })
      const abort = new AbortController()
      yield* Effect.addFinalizer(() => Effect.sync(() => abort.abort()))
      const stream = yield* Effect.promise(() => BrowserStream.open(fixture.socket, abort.signal))
      const closed = new Promise<void>((resolve) => stream.once("close", () => resolve()))
      if (reason === "attachment") fixture.tunnels.dispose()
      if (reason === "signal") abort.abort()
      yield* Effect.promise(() => closed)
      expect(stream.destroyed).toBe(true)
      if (reason === "attachment") {
        const result = yield* Effect.exit(fixture.open)
        expect(result._tag).toBe("Failure")
      }
    }),
  )
}

it.live("HTTP proxy requires local credentials and sends targets only through the binary transport", () =>
  Effect.gen(function* () {
    const target = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        return Response.json({
          body: await req.text(),
          proxyAuthorization: req.headers.get("proxy-authorization"),
          host: req.headers.get("host"),
        })
      },
    })
    yield* Effect.addFinalizer(() => Effect.sync(() => target.stop(true)))
    if (target.port === undefined) throw new Error("No HTTP port")
    const fixture = yield* serve({ host: "127.0.0.1", port: target.port })
    const destinations: Browser.TunnelTarget[] = []
    const proxy = yield* Effect.acquireRelease(
      Effect.promise(() =>
        BrowserProxy.make({
          open: (destination, signal) => {
            destinations.push(destination)
            return BrowserStream.open(fixture.socket, signal)
          },
        }),
      ),
      (proxy) => Effect.promise(() => proxy.close()),
    )
    const send = (authorization?: string) =>
      new Promise<{ status?: number; body: string }>((resolve, reject) => {
        const req = request(
          {
            hostname: proxy.host,
            port: proxy.port,
            method: "POST",
            path: `http://vps-only.invalid:${target.port}/echo`,
            headers: authorization ? { "Proxy-Authorization": authorization } : {},
          },
          (response) => {
            let body = ""
            response.on("data", (chunk) => {
              body += chunk
            })
            response.on("end", () => resolve({ status: response.statusCode, body }))
          },
        )
        req.on("error", reject)
        req.end("from the browser")
      })
    expect((yield* Effect.promise(() => send())).status).toBe(407)
    expect(destinations).toEqual([])
    const response = yield* Effect.promise(() =>
      send(`Basic ${Buffer.from(`${proxy.credentials.username}:${proxy.credentials.password}`).toString("base64")}`),
    )
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      body: "from the browser",
      host: `vps-only.invalid:${target.port}`,
      proxyAuthorization: null,
    })
    expect(destinations).toEqual([{ host: "vps-only.invalid", port: target.port }])
  }),
)

const serve = Effect.fn(function* (target: Browser.TunnelTarget) {
  const tunnels = BrowserTunnel.make()
  yield* Effect.addFinalizer(() => Effect.sync(() => tunnels.dispose()))
  const http = yield* NodeHttpServer.make(() => new Server(), { port: 0, host: "127.0.0.1" })
  yield* http
    .serve(
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        yield* tunnels.connect(target, Effect.orDie(request.upgrade)).pipe(Effect.catch(() => Effect.void))
        return HttpServerResponse.empty()
      }),
    )
    .pipe(Effect.provide(NodeHttpServer.layerHttpServices))
  const url = HttpServer.formatAddress(http.address).replace("http:", "ws:")
  const socket = Socket.makeWebSocket(url).pipe(Effect.provide(NodeSocket.layerWebSocketConstructorWS))
  return { tunnels, socket, open: socket.pipe(Effect.flatMap(BrowserStream.make)) }
})
