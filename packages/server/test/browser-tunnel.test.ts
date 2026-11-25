import { expect } from "bun:test"
import { NodeHttpClient } from "@effect/platform-node"
import { WebSocket } from "@effect/platform-node-shared/NodeWS"
import {
  BROWSER_TUNNEL_CONNECTION_HEADER,
  BROWSER_TUNNEL_PATH,
  BROWSER_TUNNEL_PROTOCOL_HEADER,
  BROWSER_TUNNEL_SESSION_HEADER,
  BROWSER_TUNNEL_TICKET_HEADER,
} from "@opencode/protocol/groups/experimental/browser-tunnel"
import { AbsolutePath } from "@opencode/schema/schema"
import { Deferred, Effect, Fiber, Schedule, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpServer } from "effect/http"
import { once } from "node:events"
import { connect } from "node:net"
import { OpenCode } from "../../client/src/effect/index"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { Browser } from "../../plugin-browser/src/rpc"
import { BrowserTunnelHost, StreamWire } from "../../plugin-browser/src/stream"
import { ServerProcess } from "../src/process"

const authHeader = `Basic ${btoa("opencode:secret")}`

// Refusals are HTTP responses. Reading them before any WebSocket exists avoids runtime-specific WS error events.
const upgradeStatus = (url: URL, headers: Record<string, string>) =>
  Effect.promise(async () => {
    const socket = connect(Number(url.port), url.hostname)
    try {
      socket.write(
        [
          `GET ${url.pathname}${url.search} HTTP/1.1`,
          `Host: ${url.host}`,
          "Connection: Upgrade",
          "Upgrade: websocket",
          "Sec-WebSocket-Version: 13",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
          "",
          "",
        ].join("\r\n"),
      )
      let response = ""
      for await (const chunk of socket) {
        response += chunk.toString("latin1")
        if (response.includes("\r\n")) return Number(response.split(" ", 2)[1])
      }
      throw new Error("Upgrade ended without an HTTP response")
    } finally {
      socket.destroy()
    }
  })

const echoServer = Effect.acquireRelease(
  Effect.sync(() =>
    Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket, chunk) {
          socket.end(chunk)
        },
      },
    }),
  ),
  (listener) => Effect.sync(() => listener.stop(true)),
)

const bootServer = (enabled = true) =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped("opencode-browser-tunnel-")).path
    const server = yield* ServerProcess.start<never, never>({
      hostname: "127.0.0.1",
      port: 0,
      password: "secret",
      app: { version: "test-version" },
      database: { path: ":memory:" },
      models: { fetch: false },
      fs: { filewatcher: false },
      config: {
        directory,
        project: false,
        content: JSON.stringify({ experimental: { browser_stream_tunnel: enabled } }),
      },
    })
    const base = HttpServer.formatAddress(server.address)
    const http = yield* HttpClient.HttpClient
    const client = yield* OpenCode.make({ baseUrl: base }).pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.mapRequest(http, HttpClientRequest.setHeader("authorization", authHeader)),
      ),
    )
    const location = { directory: AbsolutePath.make(directory) }
    yield* client.plugin.list({ location }).pipe(
      Effect.repeat({
        until: (res) => res.data.some((p) => p.id === "opencode.browser"),
        schedule: Schedule.spaced("50 millis").pipe(Schedule.upTo({ duration: "10 seconds" })),
      }),
    )
    const session = yield* client.session.create({ location })
    return { base, directory, client, location, rpc: client.rpc(Browser.Definition), sessionID: session.id }
  }).pipe(Effect.provide(NodeHttpClient.layerNodeHttp))

const attachBrowser = (env: Effect.Success<ReturnType<typeof bootServer>>, connectionID: string) =>
  Effect.gen(function* () {
    const connected = yield* Deferred.make<void>()
    const attached = yield* Deferred.make<readonly string[]>()
    yield* env.client.event.subscribe().pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          if (event.type === "server.connected") yield* Deferred.succeed(connected, undefined)
          if (event.type !== "rpc.experimental.browser.control") return
          const data = event.data as { type?: string; connectionID?: string; capabilities?: readonly string[] }
          if (data.type === "attached" && data.connectionID === connectionID)
            yield* Deferred.succeed(attached, data.capabilities ?? [])
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* Deferred.await(connected).pipe(Effect.timeout("5 seconds"))
    const attachFiber = yield* env.rpc
      .attach({ sessionID: env.sessionID, connectionID, version: 4 }, { location: env.location })
      .pipe(Effect.forkScoped({ startImmediately: true }))
    const capabilities = yield* Deferred.await(attached).pipe(Effect.timeout("10 seconds"))
    return { capabilities, attachFiber }
  })

it.live(
  "only a matching single-use ticket upgrades; attachment replacement revokes the socket and outstanding tickets",
  () =>
    Effect.gen(function* () {
      const env = yield* bootServer()
      const attachment = { sessionID: env.sessionID, connectionID: "first" }
      const options = { location: env.location }
      const first = yield* attachBrowser(env, attachment.connectionID)
      expect(first.capabilities).toContain(BrowserTunnelHost.STREAM_CAPABILITY)

      const issue = () => env.rpc["tunnel.ticket"]({ ...attachment, protocol: 1 }, options)
      const issued = yield* issue()
      expect(issued.path).toBe(BROWSER_TUNNEL_PATH)
      const url = new URL(issued.path, env.base)
      url.searchParams.set("location[directory]", env.directory)
      const headers = {
        [BROWSER_TUNNEL_SESSION_HEADER]: env.sessionID,
        [BROWSER_TUNNEL_CONNECTION_HEADER]: attachment.connectionID,
        [BROWSER_TUNNEL_PROTOCOL_HEADER]: "1",
        [BROWSER_TUNNEL_TICKET_HEADER]: issued.ticket,
      }
      const wrongLocation = new URL(url)
      wrongLocation.searchParams.set("location[directory]", env.directory + "/other")
      expect(yield* upgradeStatus(wrongLocation, headers)).toBe(403)
      const queryTicket = new URL(url)
      queryTicket.searchParams.set("ticket", issued.ticket)
      expect(yield* upgradeStatus(queryTicket, headers)).toBe(403)
      expect(
        yield* upgradeStatus(url, { ...headers, [BROWSER_TUNNEL_TICKET_HEADER]: "", authorization: authHeader }),
      ).toBe(403)
      expect(yield* upgradeStatus(url, { ...headers, [BROWSER_TUNNEL_CONNECTION_HEADER]: "other" })).toBe(403)
      expect(
        yield* upgradeStatus(url, { ...headers, [BROWSER_TUNNEL_SESSION_HEADER]: "ses_00000000000000000000000001" }),
      ).toBe(403)
      expect(yield* upgradeStatus(url, { ...headers, origin: "https://untrusted.example" })).toBe(403)
      const info = yield* Effect.promise(() => fetch(new URL("/api/info", env.base), { headers }))
      expect(info.status).toBe(401)
      yield* Effect.promise(() => info.text())

      // Native WS only on the successful path. After the HTTP attach request ends, this socket still owns the attachment.
      const socket = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const ws = new URL(url)
          ws.protocol = "ws:"
          return new WebSocket(ws, { headers })
        }),
        (ws) => Effect.sync(() => ws.terminate()),
      )
      yield* Effect.promise(() => once(socket, "open"))
      expect(yield* upgradeStatus(url, headers)).toBe(403)
      yield* Fiber.interrupt(first.attachFiber)
      const echo = yield* echoServer
      const exchange = (frame: StreamWire.Frame) =>
        Effect.promise(async () => {
          const replied = once(socket, "message")
          socket.send(StreamWire.encodeFrame(frame))
          const [raw] = await replied
          return StreamWire.decodeFrame(raw)
        })
      const streamID = 1
      expect(
        yield* exchange({
          type: StreamWire.FrameType.OPEN,
          streamID,
          host: "127.0.0.1",
          port: echo.port,
          initialWindow: 4096,
        }),
      ).toMatchObject({ type: StreamWire.FrameType.OPENED, streamID })
      const ping = { type: StreamWire.FrameType.DATA, streamID, data: Uint8Array.of(120) } as const
      expect(yield* exchange(ping)).toEqual(ping)
      // Even a client using legacy RPC on this enabled attachment must respect the real server's reserved port.
      expect(
        yield* env.rpc["tunnel.open"](
          {
            ...attachment,
            target: { host: "127.0.0.1", port: Number(url.port) },
          },
          options,
        ).pipe(Effect.flip),
      ).toMatchObject({ type: "unavailable", message: expect.stringContaining("blocked") })

      const unused = yield* issue()
      const closed = once(socket, "close")
      const next = yield* attachBrowser(env, "replacement")
      const [code] = yield* Effect.promise(() => closed)
      expect(code).toBe(BrowserTunnelHost.CLOSE_ATTACHMENT_REPLACED)
      expect(yield* upgradeStatus(url, { ...headers, [BROWSER_TUNNEL_TICKET_HEADER]: unused.ticket })).toBe(403)
      yield* Fiber.interrupt(next.attachFiber)
    }),
  20_000,
)

it.live(
  "with browser_stream_tunnel off, a v4 attachment can relay bytes but cannot issue a ticket or grant",
  () =>
    Effect.gen(function* () {
      const env = yield* bootServer(false)
      const attachment = { sessionID: env.sessionID, connectionID: "conn_legacy_1" }
      const options = { location: env.location }
      const att = yield* attachBrowser(env, attachment.connectionID)
      expect(att.capabilities).not.toContain(BrowserTunnelHost.STREAM_CAPABILITY)

      const echo = yield* echoServer
      const target = { host: "127.0.0.1", port: echo.port }
      expect(yield* env.rpc["tunnel.ticket"]({ ...attachment, protocol: 1 }, options).pipe(Effect.flip)).toMatchObject({
        type: "unavailable",
      })
      expect(yield* env.rpc["tunnel.grant"]({ ...attachment, target }, options).pipe(Effect.flip)).toMatchObject({
        type: "unavailable",
      })

      const tunnelID = yield* env.rpc["tunnel.open"]({ ...attachment, target }, options)
      const tunnel = { ...attachment, tunnelID }
      yield* env.rpc["tunnel.write"]({ ...tunnel, data: "eA==" }, options)
      const response = yield* env.rpc["tunnel.read"](tunnel, options)
      expect(Buffer.from(response.data).toString()).toBe("x")
      yield* env.rpc["tunnel.close"](tunnel, options)
      yield* Fiber.interrupt(att.attachFiber)
    }),
  20_000,
)
