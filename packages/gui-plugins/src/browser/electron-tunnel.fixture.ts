import { createServer } from "node:http"
import { WebSocketServer } from "@effect/platform-node/NodeWS"
import electron from "electron"
import { Effect, Predicate } from "effect"
import type { RpcClient } from "@opencode/client/effect/api"
import type { Browser } from "@opencode/plugin-browser/rpc"
import { BrowserTunnelHost, EgressPolicy, StreamMux, StreamWire } from "@opencode/plugin-browser/experimental/stream"
import { SessionID } from "@opencode/schema/session-id"
import { createBrowserNetwork, type BrowserNetwork } from "./network"

type ServerWs = InstanceType<typeof WebSocketServer>["clients"] extends Set<infer W> ? W : never

const sessionID = SessionID.make("ses_00000000000000000000000001")

function adaptWs(ws: ServerWs): BrowserTunnelHost.BinarySocket {
  return {
    get readyState() { return ws.readyState },
    get bufferedAmount() { return ws.bufferedAmount },
    send: (data, cb) => ws.send(data, { binary: true, compress: false }, (err) => cb?.(err ?? undefined)),
    close: (code, reason) => { if (ws.readyState <= ws.OPEN) ws.close(code, reason) },
    terminate: () => ws.terminate(),
    onMessage(listener) {
      const handler = (raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) =>
        listener(!isBinary ? String(raw) : raw instanceof Uint8Array ? raw : raw instanceof ArrayBuffer ? new Uint8Array(raw) : Buffer.concat(raw))

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
  }
}

const listen = (server: ReturnType<typeof createServer>) =>
  new Promise<string>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()

      resolve(`http://127.0.0.1:${addr && !Predicate.isString(addr) ? addr.port : 0}`)
    }),
  )

electron.app.on("window-all-closed", () => undefined)

void electron.app.whenReady().then(async () => {
  let targetHits = 0
  const html = `<!doctype html><script>window.__run=async()=>{const a=await(await fetch('/asset')).text();const b=(await(await fetch('/big')).arrayBuffer()).byteLength;const ws=await new Promise((r,j)=>{const s=new WebSocket('ws://'+location.host+'/hmr');window.__ws=s;s.onopen=()=>s.send('ping');s.onmessage=e=>r(String(e.data));s.onerror=()=>j(Error('ws'))});return{a,b,ws}}</script>`

  const target = createServer((req, res) => {
    targetHits += 1

    if (req.url === "/big") {
      const body = Buffer.alloc(128 * 1024, 0x33)
      res.writeHead(200, { "content-length": String(body.length) }).end(body)

      return
    }

    const body = req.url === "/asset" ? "ok:/asset" : html
    const type = req.url === "/asset" ? "text/plain" : "text/html"
    res.writeHead(200, { "content-type": type, "content-length": String(Buffer.byteLength(body)) }).end(body)
  })

  const targetWss = new WebSocketServer({ noServer: true })
  targetWss.on("connection", (ws) => ws.on("message", (msg) => ws.send(`hmr:${msg.toString()}`)))
  target.on("upgrade", (req, sock, head) => targetWss.handleUpgrade(req, sock, head, (ws) => targetWss.emit("connection", ws, req)))

  const tickets = new Set<string>()
  const muxes = new Set<StreamMux.ServerMux>()
  const tunnelWss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: StreamWire.MAX_WS_FRAME_BYTES })
  let rejectUpgrade = false
  const stats = { upgrades: 0, rejected: 0, ticketHeader: false, ticketCalls: 0, grantCalls: 0, legacyCalls: 0 }

  const tunnelServer = createServer((_req, res) => res.writeHead(404).end())

  tunnelServer.on("upgrade", (req, sock, head) => {
    const url = new URL(req.url ?? "/", "http://fixture")
    const ticket = req.headers["x-opencode-browser-ticket"]

    if (Predicate.isString(ticket) && ticket.length > 0 && !url.searchParams.has("ticket")) stats.ticketHeader = true

    if (rejectUpgrade || !Predicate.isString(ticket) || !tickets.delete(ticket)) {
      stats.rejected += 1
      sock.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")

      return
    }

    stats.upgrades += 1
    tunnelWss.handleUpgrade(req, sock, head, (ws) => {
      const mux = StreamMux.createServerMux(adaptWs(ws), { policy: EgressPolicy.makePolicy(), heartbeatIntervalMs: 0 })
      muxes.add(mux)
      void mux.closed.finally(() => muxes.delete(mux))
    })
  })

  const [targetOrigin, tunnelOrigin] = await Promise.all([listen(target), listen(tunnelServer)])

  const makeRpc = () => {
    const legacyFail = () => {
      stats.legacyCalls += 1

      return Effect.fail(new Error("legacy disabled"))
    }

    // SAFETY: `createBrowserNetwork` calls only the tunnel.* RPC methods exercised here.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- minimal fixture stub for Browser.Definition
    return {
      "tunnel.ticket": () =>
        Effect.sync(() => {
          stats.ticketCalls += 1
          const ticket = `tkt_${crypto.randomUUID()}`
          tickets.add(ticket)

          return { ticket, expiresIn: 30, protocol: 1 as const, path: BrowserTunnelHost.BROWSER_TUNNEL_PATH }
        }),
      "tunnel.grant": () =>
        Effect.sync(() => {
          stats.grantCalls += 1
        }),
      "tunnel.open": legacyFail,
      "tunnel.read": legacyFail,
      "tunnel.write": legacyFail,
      "tunnel.close": () => Effect.void,
    } as unknown as RpcClient<typeof Browser.Definition, unknown>
  }

  const runPartition = <A>(partition: string, caps: readonly string[], body: (win: electron.BrowserWindow, net: BrowserNetwork) => Promise<A>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const net = yield* createBrowserNetwork({
          server: { id: "remote", url: tunnelOrigin, headers: { authorization: "Basic dGVzdDp0ZXN0" }, sameMachine: false },
          rpc: makeRpc(),
          attachment: { sessionID, connectionID: partition },
          location: { directory: "/remote" },
          partition,
        })

        net.activate?.(caps)
        const win = new electron.BrowserWindow({ show: false, webPreferences: { partition } })
        const detach = net.attach(win.webContents)

        try {
          return yield* Effect.promise(() => body(win, net))
        } finally {
          detach()
          win.destroy()
        }
      }).pipe(Effect.scoped),
    )

  // 1. Advertised binary WS stream: HTTP asset + 128 KiB body + live HMR WS kept open across clean teardown.
  const streamed = await runPartition("tunnel-ok", [BrowserTunnelHost.STREAM_CAPABILITY], async (win, net) => {
    await net.grantPrivateTarget?.(targetOrigin)
    await win.loadURL(targetOrigin)

    return await win.webContents.executeJavaScript("window.__run()")
  })

  const okStats = { ...stats }
  const hitsAfterOk = targetHits

  // 2. Rejected upgrade (403): must fail with proxy 502 and never downgrade to legacy RPC or direct network.
  rejectUpgrade = true

  const blockedStatus = await runPartition("tunnel-403", [BrowserTunnelHost.STREAM_CAPABILITY], async (win) => {
    let status = 0
    win.webContents.once("did-navigate", (_event, _url, code) => { status = code })
    await win.loadURL(targetOrigin).catch(() => undefined)

    return status
  })

  const blockedHits = targetHits - hitsAfterOk
  const after403 = { ...stats }

  // 3. Unadvertised/disabled server: must never send tunnel.ticket or tunnel.grant RPCs.
  await runPartition("tunnel-off", [], async (_win, net) => {
    await net.grantPrivateTarget?.(targetOrigin)
  })

  const legacyDelta = {
    ticketCalls: stats.ticketCalls - after403.ticketCalls,
    grantCalls: stats.grantCalls - after403.grantCalls,
    upgrades: stats.upgrades - after403.upgrades,
  }

  muxes.forEach((m) => m.close())
  tunnelWss.close()
  targetWss.close()
  tunnelServer.closeAllConnections()
  target.closeAllConnections()
  tunnelServer.close()
  target.close()

  process.stdout.write(`${JSON.stringify({ streamed, okStats, blockedStatus, blockedHits, after403, legacyDelta })}\n`)
  electron.app.exit(0)
})
