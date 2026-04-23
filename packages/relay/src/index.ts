import { Hono } from "hono"
import { createBunWebSocket } from "hono/bun"
import { mintToken, readBearer, verifyToken } from "./auth"
import { PairingStore } from "./pair"
import { TunnelBroker, type TunnelSender } from "./tunnel"
import { CLIENT_TOKEN_TTL_MS, type ClaimRequest, type ClaimResponse, type PairResponse, type TunnelFrame } from "./protocol"

export type RelayOptions = {
  secret: string
  publicUrl: string
}

export function createRelay(opts: RelayOptions) {
  const pairings = new PairingStore()
  const broker = new TunnelBroker()
  const { upgradeWebSocket, websocket } = createBunWebSocket()

  const app = new Hono()

  app.get("/health", (c) => c.json({ ok: true }))

  app.post("/pair", async (c) => {
    const record = pairings.create()
    const tunnelToken = await mintToken(opts.secret, { kind: "tunnel", pairId: record.pairId })
    const body: PairResponse = {
      code: record.code,
      tunnelToken,
      expiresAt: record.expiresAt,
      claimUrl: joinUrl(opts.publicUrl, "/r/" + record.code),
    }
    return c.json(body)
  })

  app.post("/claim", async (c) => {
    const json = (await c.req.json().catch(() => ({}))) as Partial<ClaimRequest>
    if (!json.code || typeof json.code !== "string") return c.json({ error: "missing code" }, 400)
    const record = pairings.claim(json.code.toUpperCase())
    if (!record) return c.json({ error: "invalid or expired code" }, 404)
    const clientToken = await mintToken(opts.secret, { kind: "client", pairId: record.pairId })
    const body: ClaimResponse = {
      clientToken,
      expiresAt: Date.now() + CLIENT_TOKEN_TTL_MS,
    }
    return c.json(body)
  })

  app.get(
    "/tunnel",
    upgradeWebSocket(async (c) => {
      const token = c.req.query("token") ?? readBearer(c.req.header("authorization")) ?? ""
      const claims = await verifyToken(opts.secret, token)
      if (!claims || claims.kind !== "tunnel") {
        return {
          onOpen(_evt, ws) {
            try {
              ws.close(4401, "unauthorized")
            } catch {}
          },
        }
      }
      const pairId = claims.pairId
      let sender: TunnelSender | undefined
      return {
        onOpen(_evt, ws) {
          sender = {
            send: (frame: TunnelFrame) => ws.send(JSON.stringify(frame)),
            close: (code, reason) => ws.close(code, reason),
          }
          broker.register(pairId, sender)
        },
        onMessage(event) {
          const data = event.data as string | ArrayBufferLike
          broker.handleFrame(pairId, data)
        },
        onClose() {
          if (sender) broker.unregister(pairId, sender)
        },
      }
    }),
  )

  app.all("/t/*", async (c) => {
    const token = readBearer(c.req.header("authorization")) ?? c.req.query("token") ?? ""
    const claims = await verifyToken(opts.secret, token)
    if (!claims || claims.kind !== "client") return c.json({ error: "unauthorized" }, 401)
    if (!broker.isConnected(claims.pairId)) return c.json({ error: "no tunnel connected" }, 502)

    // Strip the `/t` prefix so the local opencode Hono app sees the original path.
    const url = new URL(c.req.url)
    url.pathname = url.pathname.replace(/^\/t/, "") || "/"
    const forwarded = new Request(url.toString(), {
      method: c.req.method,
      headers: c.req.raw.headers,
      body:
        c.req.method === "GET" || c.req.method === "HEAD"
          ? undefined
          : await c.req.raw.arrayBuffer().catch(() => undefined),
    })
    return broker.forward(claims.pairId, forwarded)
  })

  return { app, websocket, broker, pairings }
}

function joinUrl(base: string, path: string): string {
  const url = new URL(base)
  url.pathname = (url.pathname.replace(/\/$/, "") + path).replace(/\/+/g, "/")
  return url.toString()
}

// Bun entrypoint.
if (import.meta.main) {
  const secret = process.env["OPENCODE_RELAY_SECRET"]
  if (!secret) {
    console.error("OPENCODE_RELAY_SECRET is required")
    process.exit(1)
  }
  const port = Number(process.env["PORT"] ?? 8787)
  const publicUrl = process.env["OPENCODE_RELAY_PUBLIC_URL"] ?? `http://localhost:${port}`
  const relay = createRelay({ secret, publicUrl })

  Bun.serve({
    port,
    hostname: process.env["HOST"] ?? "0.0.0.0",
    fetch: relay.app.fetch,
    websocket: relay.websocket,
  })
  console.log(`opencode relay listening on ${publicUrl}`)
}
