import { ServerWebSocket } from "bun"

const port = Number(process.env.PORT ?? process.env.UNIVER_SDK_PORT ?? "8080")
const wsDebug = process.env.VERITLY_WS_DEBUG === "1"

const MESSAGING_SYSTEM = "veritly_relay"

function corsHeaders(origin: string | null) {
  const allowed =
    origin &&
    (/^https:\/\/([a-z0-9-]+\.)*veritly\.co\.uk$/i.test(origin) ||
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin))
  return {
    "access-control-allow-origin": allowed ? origin : "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    vary: "Origin",
  }
}

function relayAttrs(conn: number, role: string, extra?: Record<string, string | number | boolean>) {
  return {
    "messaging.system": MESSAGING_SYSTEM,
    "network.transport": "websocket",
    "veritly.relay.conn_id": conn,
    "veritly.relay.role": role,
    ...extra,
  }
}

type RelaySocketData = { role: "browser" | "agent" | "healthcheck" }
type RelayWebSocket = ServerWebSocket<RelaySocketData>

export type RequestMsg = {
  id: string
  op: string
  params?: unknown
  traceparent?: string
}

export type ResponseMsg = {
  id: string
  ok: boolean
  result?: unknown
  error?: string
  traceparent?: string
}

let connSeq = 0

let browser: RelayWebSocket | null = null
const agents = new Set<RelayWebSocket>()
const pending = new Map<string, RelayWebSocket>()
const connId = new WeakMap<RelayWebSocket, number>()

function dbg(message: string, meta?: Record<string, unknown>) {
  if (!wsDebug) return
  console.log(`[veritly-relay] ${message}`, meta ?? {})
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function sendJson(ws: RelayWebSocket, data: unknown) {
  ws.send(JSON.stringify(data))
}

function closeWithReason(ws: RelayWebSocket, reason: string) {
  sendJson(ws, { id: "relay", ok: false, error: reason })
  ws.close(1008, reason)
}

function relayHealthPayload() {
  return {
    ok: true,
    service: "relay",
    browserConnected: Boolean(browser),
    agentCount: agents.size,
    checks: [],
  }
}

Bun.serve({
  port,
  fetch(req, server) {
    const url = new URL(req.url)
    const origin = req.headers.get("origin")

    if (req.method === "OPTIONS" && (url.pathname === "/relay/readyz" || url.pathname === "/readyz")) {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      })
    }

    if (url.pathname === "/livez") {
      return new Response("ok", {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          ...corsHeaders(origin),
        },
      })
    }

    if (url.pathname === "/relay/readyz" || url.pathname === "/readyz") {
      const payload = relayHealthPayload()
      return new Response(JSON.stringify(payload), {
        status: payload.ok ? 200 : 503,
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...corsHeaders(origin),
        },
      })
    }

    if (url.pathname === "/relay/readyz/ws" || url.pathname === "/readyz/ws") {
      const upgraded = server.upgrade(req, { data: { role: "healthcheck" } })
      return upgraded ? undefined : new Response("upgrade failed", { status: 500 })
    }

    if (url.pathname !== "/relay/ws" && url.pathname !== "/ws") {
      return new Response("not found", { status: 404 })
    }

    const role = url.searchParams.get("role")
    if (role !== "browser" && role !== "agent") {
      dbg("reject ws upgrade: missing/invalid role", { role: role ?? null, path: url.pathname })
      return new Response("missing role=browser|agent", { status: 400 })
    }

    dbg("ws upgrade attempt", { role, path: url.pathname })
    const upgraded = server.upgrade(req, { data: { role } })
    dbg("ws upgrade result", { role, upgraded })
    return upgraded ? undefined : new Response("upgrade failed", { status: 500 })
  },

  websocket: {
    data: {} as RelaySocketData,

    open(ws: RelayWebSocket) {
      const id = ++connSeq
      connId.set(ws, id)

      if (ws.data.role === "healthcheck") {
        sendJson(ws, { ok: true, service: "relay", mode: "ws-healthcheck" })
        ws.close(1000, "healthcheck complete")
        return
      }

      if (ws.data.role === "browser") {
        if (browser) {
          const prev = browser
          browser = ws
          dbg("browser replaced", { oldConnId: connId.get(prev) ?? -1, newConnId: id, pending: pending.size })
          prev.close(1000, "replaced by newer browser connection")
          return
        }
        browser = ws
        dbg("browser connected", { connId: id, agents: agents.size, pending: pending.size })
        return
      }

      agents.add(ws)
      dbg("agent connected", { connId: id, agents: agents.size, pending: pending.size })
    },

    message(ws: RelayWebSocket, message: string | Buffer<ArrayBuffer>) {
      if (ws.data.role === "healthcheck") return
      const text = String(message)
      const cid = connId.get(ws) ?? -1
      const parsed = safeJsonParse(text)

      if (!parsed || typeof parsed !== "object") {
        sendJson(ws, { id: "relay", ok: false, error: "invalid json payload" })
        return
      }

      if (ws.data.role === "agent") {
        const req = parsed as Partial<RequestMsg>

        if (!req.id || !req.op) {
          sendJson(ws, { id: "relay", ok: false, error: "request must include id and op" })
          return
        }

        if (!browser) {
          dbg("agent request rejected: no browser", { connId: cid, id: req.id, op: req.op })
          sendJson(ws, { id: req.id, ok: false, error: "browser is not connected" })
          return
        }

        pending.set(req.id, ws)
        dbg("agent request forwarded", {
          agentConnId: cid,
          browserConnId: connId.get(browser) ?? -1,
          id: req.id,
          op: req.op,
          pending: pending.size,
        })
        sendJson(browser, req)
        return
      }

      const resp = parsed as Partial<ResponseMsg>

      if (!resp.id) {
        sendJson(ws, { id: "relay", ok: false, error: "response must include id" })
        return
      }

      const target = pending.get(resp.id)
      if (!target) {
        dbg("browser response unmatched", { id: resp.id, pending: pending.size })
        return
      }

      pending.delete(resp.id)
      dbg("browser response routed", {
        browserConnId: cid,
        agentConnId: connId.get(target) ?? -1,
        id: resp.id,
        ok: resp.ok ?? null,
        pending: pending.size,
      })
      sendJson(target, resp)
    },

    close(ws: RelayWebSocket, code: number, reason: string) {
      const id = connId.get(ws) ?? -1

      if (ws.data.role === "healthcheck") {
        dbg("healthcheck disconnected", { connId: id, code, reason })
        return
      }

      if (ws.data.role === "browser") {
        if (browser !== ws) return
        browser = null
        dbg("browser disconnected", { connId: id, code, reason, pending: pending.size })
        for (const [pid, agent] of pending.entries()) {
          sendJson(agent, { id: pid, ok: false, error: "browser disconnected" })
        }
        pending.clear()
        return
      }

      agents.delete(ws)
      dbg("agent disconnected", { connId: id, code, reason, agents: agents.size, pending: pending.size })
      for (const [pid, agent] of pending.entries()) {
        if (agent !== ws) continue
        pending.delete(pid)
      }
    },
  },
})

console.log(`[veritly-relay] listening on ws://0.0.0.0:${port}/relay/ws?role=agent`)
