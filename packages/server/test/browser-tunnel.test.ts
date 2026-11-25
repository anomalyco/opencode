import { expect } from "bun:test"
import { NodeHttpClient } from "@effect/platform-node"
import { WebSocket as NodeWebSocket, WebSocketServer } from "@effect/platform-node-shared/NodeWS"
import { OpenCode } from "../../client/src/effect/index"
import { Browser } from "../../plugin-browser/src/rpc"
import { BrowserProxy } from "../../plugin-browser/src/proxy"
import { BrowserTunnelHost, StreamMux } from "../../plugin-browser/src/stream"
import {
  BROWSER_TUNNEL_CONNECTION_HEADER,
  BROWSER_TUNNEL_PATH,
  BROWSER_TUNNEL_PROTOCOL_HEADER,
  BROWSER_TUNNEL_SESSION_HEADER,
  BROWSER_TUNNEL_TICKET_HEADER,
} from "@opencode/protocol/groups/browser-tunnel"
import { AbsolutePath } from "@opencode/schema/schema"
import { Deferred, Effect, Fiber, Schedule, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpServer } from "effect/http"
import { once } from "node:events"
import { createServer as createHttpServer, request as httpRequest } from "node:http"
import { connect as netConnect } from "node:net"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { it } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"

const authHeader = `Basic ${btoa("opencode:secret")}`

function adaptClientWs(ws: NodeWebSocket): BrowserTunnelHost.BinarySocket {
  return {
    get readyState() {
      return ws.readyState
    },
    get bufferedAmount() {
      return ws.bufferedAmount
    },
    send(data, onWritten) {
      ws.send(data, { binary: true, compress: false }, (error) => onWritten?.(error ?? undefined))
    },
    ping() {
      if (ws.readyState === ws.OPEN) ws.ping()
    },
    close(code, reason) {
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close(code, reason)
    },
    terminate() {
      ws.terminate()
    },
    onMessage(listener) {
      const handler = (raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
        if (!isBinary) {
          listener(String(raw))
          return
        }
        if (raw instanceof Uint8Array) listener(raw)
        else if (raw instanceof ArrayBuffer) listener(new Uint8Array(raw))
        else listener(Buffer.concat(raw))
      }
      ws.on("message", handler)
      return () => void ws.off("message", handler)
    },
    onClose(listener) {
      const handler = (code: number, reason: Buffer) => listener(code, reason.toString("utf8"))
      ws.on("close", handler)
      return () => void ws.off("close", handler)
    },
    onError(listener) {
      ws.on("error", listener)
      return () => void ws.off("error", listener)
    },
    onPong(listener) {
      ws.on("pong", listener)
      return () => void ws.off("pong", listener)
    },
  }
}

function dialRaw(
  url: string,
  headers: Record<string, string>,
): Promise<{ readonly status: 101; readonly ws: NodeWebSocket } | { readonly status: number }> {
  return new Promise((resolve, reject) => {
    const ws = new NodeWebSocket(url, {
      headers,
      perMessageDeflate: false,
      followRedirects: false,
    })
    ws.once("open", () => resolve({ status: 101, ws }))
    ws.once("unexpected-response", (_req, res) => {
      ws.terminate()
      resolve({ status: res.statusCode ?? 0 })
    })
    ws.once("error", (err) => {
      ws.terminate()
      reject(err)
    })
  })
}

const bootServer = (content = JSON.stringify({ experimental: { browser_stream_tunnel: true } })) =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireRelease(
      Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "opencode-browser-tunnel-"))),
      (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
    )
    const server = yield* ServerProcess.start<never, never>({
      hostname: "127.0.0.1",
      port: 0,
      password: "secret",
      app: { version: "test-version" },
      database: { path: ":memory:" },
      models: { fetch: false },
      config: { directory, project: false, content },
      fs: { filewatcher: false },
    })
    const base = HttpServer.formatAddress(server.address)
    const serverPort = new URL(base).port
    const http = yield* HttpClient.HttpClient
    const client = yield* OpenCode.make({ baseUrl: base }).pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.mapRequest(http, HttpClientRequest.setHeader("authorization", authHeader)),
      ),
    )
    const location = { directory: AbsolutePath.make(directory) }
    // Wait for built-in plugins (including opencode.browser) to finish activating in this location.
    yield* client.plugin.list({ location }).pipe(
      Effect.repeat({
        until: (res) => res.data.some((p) => p.id === "opencode.browser"),
        schedule: Schedule.spaced("50 millis").pipe(Schedule.upTo({ duration: "10 seconds" })),
      }),
    )
    const created = yield* client.session.create({ location })
    const rpc = client.rpc(Browser.Definition)
    return { directory, base, serverPort: Number(serverPort), client, rpc, location, sessionID: created.id }
  }).pipe(Effect.provide(NodeHttpClient.layerNodeHttp))

const attachBrowser = (
  env: Effect.Success<ReturnType<typeof bootServer>>,
  connectionID: string,
) =>
  Effect.gen(function* () {
    const connected = yield* Deferred.make<void>()
    const attached = yield* Deferred.make<readonly string[]>()
    const eventsFiber = yield* env.client.event.subscribe().pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          if (event.type === "server.connected") {
            yield* Deferred.succeed(connected, undefined)
            return
          }
          if (event.type !== "rpc.experimental.browser.control") return
          const data = event.data as { type?: string; connectionID?: string; capabilities?: readonly string[] }
          if (data.type === "attached" && data.connectionID === connectionID) {
            yield* Deferred.succeed(attached, data.capabilities ?? [])
          }
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* Deferred.await(connected).pipe(Effect.timeout("5 seconds"))
    const attachFiber = yield* env.rpc
      .attach({ sessionID: env.sessionID, connectionID, version: 4 }, { location: env.location })
      .pipe(Effect.forkScoped({ startImmediately: true }))
    const capabilities = yield* Deferred.await(attached).pipe(Effect.timeout("10 seconds"))
    return { capabilities, attachFiber, eventsFiber }
  })

it.live(
  "authenticates single-use header tickets, multiplexes pooled HTTP + 1MiB + WS + CONNECT, enforces egress and replacement",
  () =>
    Effect.gen(function* () {
      const env = yield* bootServer()

      // Target HTTP + WebSocket server on 127.0.0.1
      let targetTcpConnections = 0
      const targetHttp = createHttpServer((req, res) => {
        if (req.url === "/big") {
          const body = Buffer.alloc(1024 * 1024, 0x5a)
          res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(body.length) })
          res.end(body)
          return
        }
        const text = `ok:${req.url}`
        res.writeHead(200, { "content-type": "text/plain", "content-length": String(text.length) })
        res.end(text)
      })
      targetHttp.on("connection", () => {
        targetTcpConnections += 1
      })
      const targetWss = new WebSocketServer({ noServer: true })
      targetWss.on("connection", (ws) => {
        ws.on("message", (msg) => ws.send(`hmr:${msg.toString()}`))
      })
      targetHttp.on("upgrade", (req, socket, head) => {
        targetWss.handleUpgrade(req, socket, head, (ws) => targetWss.emit("connection", ws, req))
      })
      yield* Effect.acquireRelease(
        Effect.promise(async () => {
          await once(targetHttp.listen(0, "127.0.0.1"), "listening")
          return targetHttp
        }),
        () =>
          Effect.promise(
            () =>
              new Promise<void>((resolve) => {
                targetWss.close()
                targetHttp.closeAllConnections()
                targetHttp.close(() => resolve())
              }),
          ),
      )
      const targetAddr = targetHttp.address()
      if (!targetAddr || typeof targetAddr === "string") throw new Error("No target address")

      const conn1 = "conn_stream_1"
      const att1 = yield* attachBrowser(env, conn1)
      expect(att1.capabilities).toContain(BrowserTunnelHost.STREAM_CAPABILITY)

      const issued = yield* env.rpc["tunnel.ticket"](
        { sessionID: env.sessionID, connectionID: conn1, protocol: 1 },
        { location: env.location },
      )
      expect(issued.path).toBe(BROWSER_TUNNEL_PATH)
      expect(issued.protocol).toBe(1)

      const wsUrl = new URL(issued.path, env.base)
      wsUrl.protocol = "ws:"
      wsUrl.searchParams.set("location[directory]", env.directory)
      const baseHeaders = {
        [BROWSER_TUNNEL_SESSION_HEADER]: env.sessionID,
        [BROWSER_TUNNEL_CONNECTION_HEADER]: conn1,
        [BROWSER_TUNNEL_PROTOCOL_HEADER]: "1",
      }

      // Adversarial rejections BEFORE valid upgrade:
      // 1. Missing ticket header even with valid Basic Authorization -> 403
      expect(
        (yield* Effect.promise(() => dialRaw(wsUrl.toString(), { ...baseHeaders, authorization: authHeader }))).status,
      ).toBe(403)
      // 2. Ticket in query string instead of header -> 403
      const queryTicketUrl = new URL(wsUrl.toString())
      queryTicketUrl.searchParams.set("ticket", issued.ticket)
      expect(
        (
          yield* Effect.promise(() =>
            dialRaw(queryTicketUrl.toString(), {
              ...baseHeaders,
              [BROWSER_TUNNEL_TICKET_HEADER]: issued.ticket,
            }),
          )
        ).status,
      ).toBe(403)
      // 3. Disallowed cross-origin browser Origin -> 403
      expect(
        (
          yield* Effect.promise(() =>
            dialRaw(wsUrl.toString(), {
              ...baseHeaders,
              [BROWSER_TUNNEL_TICKET_HEADER]: issued.ticket,
              origin: "https://evil.attacker.example",
            }),
          )
        ).status,
      ).toBe(403)
      // 4. Wrong sessionID / connectionID / location -> 403 (does not burn valid ticket)
      expect(
        (
          yield* Effect.promise(() =>
            dialRaw(wsUrl.toString(), {
              ...baseHeaders,
              [BROWSER_TUNNEL_CONNECTION_HEADER]: "wrong-conn",
              [BROWSER_TUNNEL_TICKET_HEADER]: issued.ticket,
            }),
          )
        ).status,
      ).toBe(403)
      const wrongLocUrl = new URL(wsUrl.toString())
      wrongLocUrl.searchParams.set("location[directory]", path.join(env.directory, "other"))
      expect(
        (
          yield* Effect.promise(() =>
            dialRaw(wrongLocUrl.toString(), {
              ...baseHeaders,
              [BROWSER_TUNNEL_TICKET_HEADER]: issued.ticket,
            }),
          )
        ).status,
      ).toBe(403)

      // 5. Valid upgrade succeeds with ticket-only header (no Basic auth required on WS upgrade!)
      const upgraded = yield* Effect.promise(() =>
        dialRaw(wsUrl.toString(), { ...baseHeaders, [BROWSER_TUNNEL_TICKET_HEADER]: issued.ticket }),
      )
      expect(upgraded.status).toBe(101)
      if (!("ws" in upgraded)) throw new Error("Expected 101")

      // 6. Ticket replay immediately fails with 403 (single-use atomic consumption!)
      expect(
        (
          yield* Effect.promise(() =>
            dialRaw(wsUrl.toString(), { ...baseHeaders, [BROWSER_TUNNEL_TICKET_HEADER]: issued.ticket }),
          )
        ).status,
      ).toBe(403)

      const mux = StreamMux.createClientMux(adaptClientWs(upgraded.ws), { heartbeatIntervalMs: 0 })
      const proxy = yield* Effect.acquireRelease(
        Effect.promise(() => BrowserProxy.make({ openStream: (target, signal) => mux.openStream(target, signal) })),
        (p) => Effect.promise(() => p.close()),
      )
      const proxyAuth = `Basic ${Buffer.from(`${proxy.credentials.username}:${proxy.credentials.password}`).toString("base64")}`

      // 7. 8 sequential HTTP assets reuse 1 target TCP connection over the single prewarmed WS!
      const getViaProxy = (urlPath: string) =>
        new Promise<{ status?: number; body: Buffer }>((resolve, reject) => {
          const req = httpRequest(
            {
              hostname: proxy.host,
              port: proxy.port,
              method: "GET",
              path: `http://127.0.0.1:${targetAddr.port}${urlPath}`,
              headers: { "Proxy-Authorization": proxyAuth },
            },
            (res) => {
              const chunks: Buffer[] = []
              res.on("data", (chunk: Buffer) => chunks.push(chunk))
              res.once("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }))
            },
          )
          req.once("error", reject)
          req.end()
        })

      yield* Effect.promise(async () => {
        for (let i = 0; i < 8; i++) {
          const res = await getViaProxy(`/a-${i}.js`)
          expect(res.status).toBe(200)
          expect(res.body.toString()).toBe(`ok:/a-${i}.js`)
        }
        expect(targetTcpConnections).toBe(1)

        // 8. 1 MiB response streams intact over the same binary WS
        const big = await getViaProxy("/big")
        expect(big.status).toBe(200)
        expect(big.body.byteLength).toBe(1024 * 1024)

        // 9. WebSocket (HMR) works through proxy -> binary WS -> target server
        const wsEcho = await new Promise<string>((resolve, reject) => {
          const sock = netConnect(proxy.port, proxy.host, () => {
            sock.write(
              `GET http://127.0.0.1:${targetAddr.port}/hmr HTTP/1.1\r\n` +
                `Host: 127.0.0.1:${targetAddr.port}\r\n` +
                `Proxy-Authorization: ${proxyAuth}\r\n` +
                `Connection: Upgrade\r\n` +
                `Upgrade: websocket\r\n` +
                `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
                `Sec-WebSocket-Version: 13\r\n\r\n`,
            )
          })
          let buf = ""
          sock.on("data", (chunk) => {
            buf += chunk.toString("latin1")
            if (buf.includes("\r\n\r\n")) {
              sock.destroy()
              resolve(buf.split("\r\n")[0] ?? "")
            }
          })
          sock.once("error", reject)
        })
        expect(wsEcho).toContain("101")

        // 10. CONNECT tunnel works through proxy -> binary WS -> target server
        const connectResp = await new Promise<string>((resolve, reject) => {
          const sock = netConnect(proxy.port, proxy.host, () => {
            sock.write(
              `CONNECT 127.0.0.1:${targetAddr.port} HTTP/1.1\r\n` +
                `Host: 127.0.0.1:${targetAddr.port}\r\n` +
                `Proxy-Authorization: ${proxyAuth}\r\n\r\n`,
            )
          })
          let got = ""
          let established = false
          sock.on("data", (chunk) => {
            got += chunk.toString("utf8")
            if (!established && got.includes("200 Connection Established\r\n\r\n")) {
              established = true
              got = ""
              sock.write(`GET /via-connect HTTP/1.1\r\nHost: 127.0.0.1:${targetAddr.port}\r\nConnection: close\r\n\r\n`)
            } else if (established && got.includes("ok:/via-connect")) {
              sock.destroy()
              resolve(got)
            }
          })
          sock.once("error", reject)
        })
        expect(connectResp).toContain("ok:/via-connect")

        // 11. Self-SSRF protection: OpenCode's own listening port AND cloud metadata are blocked!
        await expect(mux.openStream({ host: "127.0.0.1", port: env.serverPort })).rejects.toThrow("blocked")
        await expect(mux.openStream({ host: "169.254.169.254", port: 80 })).rejects.toThrow("blocked")
      })

      // 12. WS-owned liveness: interrupting the silent attach HTTP call does NOT drop the live WS stream!
      yield* Fiber.interrupt(att1.attachFiber)
      const afterAttachDrop = yield* Effect.promise(() => getViaProxy("/still-alive"))
      expect(afterAttachDrop.status).toBe(200)
      expect(afterAttachDrop.body.toString()).toBe("ok:/still-alive")

      // 13. Attachment replacement revokes old attachment's unconsumed tickets AND closes its WS with 4002!
      const revokedTicket = yield* env.rpc["tunnel.ticket"](
        { sessionID: env.sessionID, connectionID: conn1, protocol: 1 },
        { location: env.location },
      )
      const conn2 = "conn_stream_2"
      const att2 = yield* attachBrowser(env, conn2)
      expect(att2.capabilities).toContain(BrowserTunnelHost.STREAM_CAPABILITY)
      const muxClosed = yield* Effect.promise(() => mux.closed)
      expect(muxClosed.replaced).toBe(true)
      expect(
        (
          yield* Effect.promise(() =>
            dialRaw(wsUrl.toString(), { ...baseHeaders, [BROWSER_TUNNEL_TICKET_HEADER]: revokedTicket.ticket }),
          )
        ).status,
      ).toBe(403)
      yield* Fiber.interrupt(att2.attachFiber)
    }),
  20_000,
)

it.live("disabling browser_stream_tunnel omits capability, refuses ticket, and preserves legacy RPC with egress policy", () =>
  Effect.gen(function* () {
    const env = yield* bootServer(JSON.stringify({ experimental: { browser_stream_tunnel: false } }))
    const conn = "conn_legacy_1"
    const att = yield* attachBrowser(env, conn)
    expect(att.capabilities).not.toContain(BrowserTunnelHost.STREAM_CAPABILITY)

    // Ticket RPC fails when flag is off
    const ticketExit = yield* env.rpc["tunnel.ticket"](
      { sessionID: env.sessionID, connectionID: conn, protocol: 1 },
      { location: env.location },
    ).pipe(Effect.exit)
    expect(ticketExit._tag).toBe("Failure")

    // Legacy RPC still blocks OpenCode's own port and metadata endpoints
    const blockedExit = yield* env.rpc["tunnel.open"](
      { sessionID: env.sessionID, connectionID: conn, target: { host: "127.0.0.1", port: env.serverPort } },
      { location: env.location },
    ).pipe(Effect.exit)
    expect(blockedExit._tag).toBe("Failure")

    yield* Fiber.interrupt(att.attachFiber)
  }),
  20_000,
)
