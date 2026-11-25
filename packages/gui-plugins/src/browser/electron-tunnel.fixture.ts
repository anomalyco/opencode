import { createServer, type ServerResponse } from "node:http"
import { WebSocketServer } from "@effect/platform-node/NodeWS"
import electron from "electron"
import { Match, Predicate } from "effect"
import type { BuiltinMainStorage } from "@opencode/plugin/gui/builtin"
import type { Embeds } from "@opencode/plugin/gui/main"
import type { Browser } from "@opencode/plugin-browser/rpc"
import { BrowserTunnelHost, EgressPolicy, StreamMux, StreamWire } from "@opencode/plugin-browser/experimental/stream"
import type { PaneEvent } from "./ipc"
import type { Profile } from "./profile"

// Real Electron main -> binary WebSocket stream tunnel end-to-end fixture.
// Exercises Chromium in a remote private partition (`sameMachine: false`) loading a page with
// 8 HTTP assets, a 512 KiB payload, and an HMR WebSocket over one prewarmed ticket-authenticated
// binary WebSocket, then verifies a 403-rejected upgrade never downgrades to legacy RPC or direct network.

type ControlPayload =
  | { readonly type: "attached"; readonly connectionID: string; readonly version: 4; readonly capabilities?: readonly string[] }
  | { readonly type: "command"; readonly connectionID: string; readonly requestID: string }

type EventFrame =
  | { readonly type: "server.connected"; readonly data: Record<string, never> }
  | {
      readonly type: "rpc.experimental.browser.control"
      readonly created: number
      readonly location: { readonly directory: string }
      readonly data: ControlPayload
    }

type RpcOutcome = { readonly type: string; readonly result?: { readonly value: unknown }; readonly message?: string }

type RpcBody = {
  readonly input: {
    readonly sessionID?: string
    readonly connectionID?: string
    readonly requestID?: string
    readonly outcome?: RpcOutcome
  }
}

function createTargetSite() {
  let targetConnections = 0
  let hits = 0

  const server = createServer((req, res) => {
    hits += 1

    if (req.url === "/big") {
      const body = Buffer.alloc(512 * 1024, 0x33)
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(body.length) })
      res.end(body)

      return
    }

    if (req.url === "/redirect") {
      // Immediate client-side redirect during load (mirrors SPA/Slack workspace redirect behavior).
      const redirectHtml = `<!doctype html><script>location.replace("/redirect-target")</script><img src="/slow-img">`
      res.writeHead(200, { "content-type": "text/html", "content-length": String(Buffer.byteLength(redirectHtml)) })
      res.end(redirectHtml)

      return
    }

    if (req.url === "/slow-img") return

    if (req.url === "/redirect-target") {
      const finalHtml = "<!doctype html><title>Redirected Workspace</title><p>ready</p>"
      res.writeHead(200, { "content-type": "text/html", "content-length": String(Buffer.byteLength(finalHtml)) })
      res.end(finalHtml)

      return
    }

    if (req.url?.startsWith("/asset-")) {
      const text = `ok:${req.url}`
      res.writeHead(200, { "content-type": "text/plain", "content-length": String(text.length) })
      res.end(text)

      return
    }

    const html = `<!doctype html>
<title>Remote Tunnel Fixture</title>
<script>
window.__run = async () => {
  const assets = []
  for (let i = 0; i < 8; i++) {
    const r = await fetch("/asset-" + i)
    assets.push(await r.text())
  }
  const big = await (await fetch("/big")).arrayBuffer()
  const wsReply = await new Promise((resolve, reject) => {
    const ws = new WebSocket("ws://" + location.host + "/hmr")
    window.__keepWs = ws
    ws.onopen = () => ws.send("ping")
    ws.onmessage = (e) => { resolve(String(e.data)) }
    ws.onerror = () => reject(new Error("ws failed"))
  })
  return { assetsCount: assets.length, firstAsset: assets[0], lastAsset: assets[7], bigBytes: big.byteLength, wsReply }
}
</script>`

    res.writeHead(200, { "content-type": "text/html", "content-length": String(Buffer.byteLength(html)) })
    res.end(html)
  })

  server.on("connection", () => {
    targetConnections += 1
  })
  const wss = new WebSocketServer({ noServer: true })
  wss.on("connection", (ws) => {
    ws.on("message", (msg) => ws.send(`hmr:${msg.toString()}`))
  })
  server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req))
  })

  return {
    server,
    stats: () => ({ targetConnections, hits }),
    close() {
      wss.close()
      server.closeAllConnections()
      server.close()
    },
  }
}

type ServerWs = InstanceType<typeof WebSocketServer>["clients"] extends Set<infer W> ? W : never

function adaptServerWs(ws: ServerWs): BrowserTunnelHost.BinarySocket {
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

        if (raw instanceof Uint8Array) {
          listener(raw)

          return
        }

        if (raw instanceof ArrayBuffer) {
          listener(new Uint8Array(raw))

          return
        }

        listener(Buffer.concat(raw))
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

function createRemoteServer(directory: string, mode: "stream" | "reject-upgrade" | "legacy-unadvertised") {
  const streams = new Set<ServerResponse>()
  const commands = new Map<string, Browser.Action>()
  const results = new Map<string, (outcome: RpcOutcome) => void>()
  const tickets = new Map<string, { sessionID: string; connectionID: string }>()
  const attached = { connectionID: "" }

  const counters = {
    upgrades: 0,
    rejectedUpgrades: 0,
    legacyTunnelCalls: 0,
    ticketCalls: 0,
    grantCalls: 0,
    ticketHeaderPresent: false,
  }

  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: StreamWire.MAX_WS_FRAME_BYTES })
  const muxes = new Set<StreamMux.ServerMux>()

  const session = {
    id: "ses_remote_tunnel",
    projectID: "prj_fixture",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
    location: { directory },
  }

  const frame = (event: EventFrame) => `data: ${JSON.stringify({ id: `evt_${Date.now()}`, ...event })}\n\n`

  const control = (data: ControlPayload) =>
    streams.forEach((stream) =>
      stream.write(frame({ type: "rpc.experimental.browser.control", created: 0, location: session.location, data })),
    )

  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://fixture").pathname

    if (pathname === "/api/event") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
      res.write(frame({ type: "server.connected", data: {} }))
      streams.add(res)

      return
    }

    if (pathname === "/api/session/ses_remote_tunnel") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ data: session }))

      return
    }

    if (pathname === "/api/plugin") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          location: session.location,
          data: [{ id: "opencode.browser", source: { type: "builtin" }, features: { server: true }, state: { status: "active" } }],
        }),
      )

      return
    }

    if (!pathname.startsWith("/api/rpc/experimental.browser/")) {
      res.writeHead(404).end()

      return
    }

    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      // SAFETY: only this fixture's OpenCode RPC client posts JSON bodies to this local stub.
      const parsed = JSON.parse(Buffer.concat(chunks).toString()) as RpcBody
      const input = parsed.input

      if (pathname.endsWith("/attach")) {
        attached.connectionID = input.connectionID ?? ""
        control(
          mode === "legacy-unadvertised"
            ? { type: "attached", connectionID: attached.connectionID, version: 4 }
            : {
                type: "attached",
                connectionID: attached.connectionID,
                version: 4,
                capabilities: [BrowserTunnelHost.STREAM_CAPABILITY],
              },
        )

        return
      }

      if (pathname.endsWith("/tunnel.ticket")) {
        counters.ticketCalls += 1
        const ticket = `tkt_${crypto.randomUUID()}`
        tickets.set(ticket, { sessionID: input.sessionID ?? "", connectionID: input.connectionID ?? "" })
        res.writeHead(200, { "content-type": "application/json" })
        res.end(
          JSON.stringify({
            output: { ticket, expiresIn: 30, protocol: 1, path: BrowserTunnelHost.BROWSER_TUNNEL_PATH },
          }),
        )

        return
      }

      if (pathname.endsWith("/tunnel.grant")) {
        counters.grantCalls += 1
        res.writeHead(200, { "content-type": "application/json" })
        res.end("{}")

        return
      }

      if (pathname.includes("/tunnel.open") || pathname.includes("/tunnel.read") || pathname.includes("/tunnel.write")) {
        counters.legacyTunnelCalls += 1
        res.writeHead(400).end("{}")

        return
      }

      res.writeHead(200, { "content-type": "application/json" })

      if (pathname.endsWith("/command")) {
        res.end(JSON.stringify({ output: { action: commands.get(input.requestID ?? ""), files: [] } }))

        return
      }

      if (pathname.endsWith("/result") && input.outcome) {
        results.get(input.requestID ?? "")?.(input.outcome)
      }

      res.end("{}")
    })
  })

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://fixture")
    const ticket = req.headers["x-opencode-browser-ticket"]

    if (Predicate.isString(ticket) && ticket.length > 0 && !url.searchParams.has("ticket")) {
      counters.ticketHeaderPresent = true
    }

    if (mode !== "stream" || !Predicate.isString(ticket) || !tickets.has(ticket)) {
      counters.rejectedUpgrades += 1
      socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")

      return
    }

    tickets.delete(ticket)
    counters.upgrades += 1
    wss.handleUpgrade(req, socket, head, (ws) => {
      const mux = StreamMux.createServerMux(adaptServerWs(ws), {
        policy: EgressPolicy.makePolicy(),
        heartbeatIntervalMs: 0,
      })

      muxes.add(mux)
      void mux.closed.finally(() => muxes.delete(mux))
    })
  })

  return {
    server,
    counters,
    agent(action: Browser.Action) {
      const requestID = `req-${commands.size}`
      const answered = Promise.withResolvers<RpcOutcome>()
      commands.set(requestID, action)
      results.set(requestID, answered.resolve)
      control({ type: "command", connectionID: attached.connectionID, requestID })

      return answered.promise
    },
    close() {
      muxes.forEach((m) => m.close())
      wss.close()
      streams.forEach((s) => s.destroy())
      server.closeAllConnections()
      server.close()
    },
  }
}

const listen = (server: ReturnType<typeof createServer>) =>
  new Promise<string>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      const port = addr && !Predicate.isString(addr) ? addr.port : 0

      resolve(`http://127.0.0.1:${port}`)
    }),
  )

void electron.app.whenReady().then(async () => {
  const { createBrowserPane } = await import("./pane")
  const { createHandlePath } = await import("./disk")
  const { createPreviews } = await import("./profile/previews")
  const { RefsStore } = await import("./refs")
  const { createSitePermissions } = await import("./site-permissions")
  const { createSystemMedia } = await import("./system-media")

  const target = createTargetSite()
  const okServer = createRemoteServer("/remote/work", "stream")
  const blockedServer = createRemoteServer("/remote/blocked", "reject-upgrade")
  const legacyServer = createRemoteServer("/remote/legacy", "legacy-unadvertised")

  const [targetOrigin, okServerUrl, blockedServerUrl, legacyServerUrl] = await Promise.all([
    listen(target.server),
    listen(okServer.server),
    listen(blockedServer.server),
    listen(legacyServer.server),
  ])

  const win = new electron.BrowserWindow({ show: false, width: 800, height: 600 })
  const values = new Map<string, unknown>()
  const lifetime = new AbortController()
  const verifier = createHandlePath()
  const profileSession = electron.session.fromPartition("tunnel-fixture")

  // SAFETY: minimal test storage matching BuiltinMainStorage reads/writes.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- test fixture stub
  const storage = {
    store: (key: string, options: { initial: unknown }) => ({
      get value() {
        return values.has(key) ? values.get(key) : options.initial
      },
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- test fixture stub
      set: (next: unknown) => values.set(key, next),
    }),
  } as unknown as BuiltinMainStorage

  const embeds: Embeds = {
    create(view, window) {
      window.contentView.addChildView(view)
      view.setBounds({ x: 0, y: 0, width: 800, height: 600 })

      return {
        id: "embed",
        show: (visible) => view.setVisible(visible),
        on: () => () => undefined,
        capture: async () => undefined,
        dispose: () => window.contentView.removeChildView(view),
      }
    },
  }

  // SAFETY: remote partition uses only downloads, permissions, link, previews.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- test fixture stub
  const profile = {
    partition: "tunnel-fixture",
    session: profileSession,
    previews: createPreviews(profileSession, lifetime.signal, verifier),
    link: () => ({ signedIn: () => undefined, unlink: () => undefined }),
    extensionIDs: () => [],
    extensionMenu: () => [],
    extensionTabs: { register: () => () => undefined, activated: () => undefined, hidden: () => undefined },
    downloads: new Map(),
    permissions: new Map(),
  } as unknown as Profile

  const endpoint = (id: string) =>
    Match.value(id).pipe(
      Match.when("remote-ok", () => ({
        id,
        url: okServerUrl,
        headers: { authorization: "Basic dGVzdDp0ZXN0" },
        sameMachine: false,
      })),
      Match.when("remote-blocked", () => ({
        id,
        url: blockedServerUrl,
        headers: { authorization: "Basic dGVzdDp0ZXN0" },
        sameMachine: false,
      })),
      Match.when("remote-legacy", () => ({
        id,
        url: legacyServerUrl,
        headers: { authorization: "Basic dGVzdDp0ZXN0" },
        sameMachine: false,
      })),
      Match.orElse(() => undefined),
    )

  const pane = createBrowserPane({
    toolbar: false,
    windows: { get: (id) => (id === win.id ? win : undefined), list: () => [win], focused: () => win, on: () => () => undefined },
    t: (key) => key,
    serverEndpoints: { get: endpoint },
    storage,
    refs: storage.store("refs", RefsStore),
    embeds,
    profile,
    sites: createSitePermissions(storage, () => undefined),
    system: createSystemMedia(),
    verifier,
    log: { write: () => undefined },
    emit: (_window, _value: { readonly event: PaneEvent }) => undefined,
  })

  // 1. Happy path: remote partition -> prewarmed binary WS -> target site (8 HTTP + 512KiB + HMR WS)
  await pane.register(win.id, "b-ok", { server: "remote-ok", session: "ses_remote_tunnel" })
  const opened = await okServer.agent({ type: "tabs.open", url: `${targetOrigin}/` })
  // SAFETY: `tabs.open` resolves with a Tab containing `id` when successful.
  const openedTab = opened.result?.value as { id: Browser.TabID } | undefined

  if (!openedTab?.id) throw new Error(`Remote tabs.open failed: ${JSON.stringify(opened)}`)

  const evaluated = await okServer.agent({
    type: "evaluate",
    tabID: openedTab.id,
    script: "window.__run()",
  })

  // SAFETY: `evaluate` resolves with `{ tab, value }` when successful.
  const pageData = (evaluated.result?.value as { value?: unknown } | undefined)?.value

  // 1b. Client redirect during load commits cleanly without reporting false ERR_ABORTED (-3)
  const redirected = await okServer.agent({
    type: "navigate",
    tabID: openedTab.id,
    url: `${targetOrigin}/redirect`,
  })

  // SAFETY: `navigate` resolves with the committed Tab record when successful.
  const redirectedTab = redirected.result?.value as { url?: string; loadError?: string } | undefined

  // 1c. Trusted user navigation on an advertised stream attachment sends tunnel.grant.
  await pane.command(win.id, "b-ok", { type: "navigate", tabID: openedTab.id, url: `${targetOrigin}/redirect-target` })
  const targetStatsAfterOk = target.stats()

  // 2. Negative path: 403-rejected upgrade must NEVER downgrade to legacy RPC or direct desktop network
  await pane.register(win.id, "b-blocked", { server: "remote-blocked", session: "ses_remote_tunnel" })
  const blockedOpen = await blockedServer.agent({ type: "tabs.open", url: `${targetOrigin}/` })
  // SAFETY: `tabs.open` returns the tab record with `loadError` on 502 proxy rejection.
  const blockedTab = blockedOpen.result?.value as { loadError?: string; title?: string } | undefined
  const targetStatsAfterBlocked = target.stats()

  // 3. Unadvertised / disabled server: trusted user navigation must NOT send tunnel.ticket or tunnel.grant RPCs.
  await pane.register(win.id, "b-legacy", { server: "remote-legacy", session: "ses_remote_tunnel" })
  await pane.command(win.id, "b-legacy", { type: "tabs.open", url: `${targetOrigin}/redirect-target` }).catch(() => undefined)

  await pane.dispose()
  lifetime.abort()
  win.destroy()
  okServer.close()
  blockedServer.close()
  legacyServer.close()
  target.close()

  process.stdout.write(
    `${JSON.stringify({
      pageData,
      redirectOutcome: redirected.type,
      redirectUrl: redirectedTab?.url ?? "",
      okCounters: okServer.counters,
      blockedOutcome: blockedOpen.type,
      blockedLoadError: blockedTab?.loadError ?? "",
      blockedCounters: blockedServer.counters,
      legacyCounters: legacyServer.counters,
      directHitsDuringBlocked: targetStatsAfterBlocked.hits - targetStatsAfterOk.hits,
    })}\n`,
  )
  electron.app.exit(0)
})
