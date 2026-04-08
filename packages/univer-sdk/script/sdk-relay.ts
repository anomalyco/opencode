import { ServerWebSocket } from "bun"

/** Passed from `server.upgrade(req, { data: { role } })` — used to type `ws.data` in handlers. */
type RelaySocketData = { role: "browser" | "agent" }
type RelayWebSocket = ServerWebSocket<RelaySocketData>

type RequestMsg = {
  id: string
  op: string
  params?: unknown
}

type ResponseMsg = {
  id: string
  ok: boolean
  result?: unknown
  error?: string
}

const port = Number(process.env.UNIVER_SDK_PORT ?? "18766")

let browser: RelayWebSocket | null = null
const agents = new Set<RelayWebSocket>()
const pending = new Map<string, RelayWebSocket>()

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

Bun.serve({
  port,
  fetch(req, server) {
    const url = new URL(req.url)
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, browserConnected: Boolean(browser), agentCount: agents.size }), {
        headers: { "content-type": "application/json; charset=utf-8" },
      })
    }
    if (url.pathname !== "/ws") return new Response("not found", { status: 404 })
    const role = url.searchParams.get("role")
    if (role !== "browser" && role !== "agent") {
      return new Response("missing role=browser|agent", { status: 400 })
    }
    const upgraded = server.upgrade(req, { data: { role } })
    return upgraded ? undefined : new Response("upgrade failed", { status: 500 })
  },
  websocket: {
    // Bun: phantom `data` tells TS the shape of `ws.data` on ServerWebSocket (see bun-types WebSocketHandler<T>).
    data: {} as RelaySocketData,
    open(ws: RelayWebSocket) {
      if (ws.data.role === "browser") {
        if (browser) {
          const prev = browser
          browser = ws
          prev.close(1000, "replaced by newer browser connection")
          return
        }
        browser = ws
        return
      }
      agents.add(ws)
    },
    message(ws: RelayWebSocket, message: string | Buffer<ArrayBuffer>) {
      const text = String(message)
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
          sendJson(ws, { id: req.id, ok: false, error: "browser is not connected" })
          return
        }
        pending.set(req.id, ws)
        sendJson(browser, req)
        return
      }

      const resp = parsed as Partial<ResponseMsg>
      if (!resp.id) {
        sendJson(ws, { id: "relay", ok: false, error: "response must include id" })
        return
      }
      const target = pending.get(resp.id)
      if (!target) return
      pending.delete(resp.id)
      sendJson(target, resp)
    },
    close(ws: RelayWebSocket, _code: number, _reason: string) {
      if (ws.data.role === "browser") {
        if (browser !== ws) return
        browser = null
        for (const [id, agent] of pending.entries()) {
          sendJson(agent, { id, ok: false, error: "browser disconnected" })
        }
        pending.clear()
        return
      }

      agents.delete(ws)
      for (const [id, agent] of pending.entries()) {
        if (agent !== ws) continue
        pending.delete(id)
      }
    },
  },
})

console.log(`univer-sdk relay ws://127.0.0.1:${port}/ws?role=agent`)
