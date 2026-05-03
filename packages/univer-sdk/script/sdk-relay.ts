import { ServerWebSocket } from "bun"
import {
  context,
  propagation,
  ROOT_CONTEXT,
  trace,
  SpanStatusCode,
  type Context,
  type Span,
  type SpanContext,
  type TextMapGetter,
} from "@opentelemetry/api"
import { initVeritlyTracer } from "@veritly/telemetry-veritly"

const port = Number(process.env.UNIVER_SDK_PORT ?? "18766")
const wsDebug = process.env.VERITLY_WS_DEBUG === "1"

initVeritlyTracer({
  serviceName: "veritly-sdk-relay",
  useAsyncLocalStorage: false,
  bootstrapAttributes: {
    "veritly.relay.port": port,
    "veritly.relay.ws_debug": wsDebug,
  },
})
const tracer = trace.getTracer("veritly-sdk-relay")

const MESSAGING_SYSTEM = "veritly_univer_relay"

const textMapGetter: TextMapGetter<Record<string, string>> = {
  get(carrier, key) {
    return carrier[key]
  },
  keys(carrier) {
    return Object.keys(carrier)
  },
}

const relayTextMapSetter = {
  set(carrier: Record<string, string>, key: string, value: string) {
    carrier[key] = value
  },
}

/**
 * So the browser can parent `relay.browser.message` under this `relay.message` span (same trace_id).
 * Must use `msgSpan` explicitly: with `useAsyncLocalStorage: false`, `context.active()` stays ROOT
 * inside `startActiveSpan` callbacks, so `inject(context.active())` never sees the current span.
 */
function forwardToBrowser(req: Partial<RequestMsg>, msgSpan: Span): Partial<RequestMsg> {
  if (typeof req.traceparent === "string" && req.traceparent.trim()) return req
  const carrier: Record<string, string> = {}
  const spanCtx = trace.setSpanContext(ROOT_CONTEXT, msgSpan.spanContext())
  propagation.inject(spanCtx, carrier, relayTextMapSetter)
  const tp = carrier.traceparent?.trim()
  return tp ? { ...req, traceparent: tp } : req
}

function headersToCarrier(headers: Headers) {
  const c: Record<string, string> = {}
  headers.forEach((v, k) => {
    c[k] = v
  })
  return c
}

/** Parent `Context` for a span that should continue trace `sc` (HTTP → WS → messages). */
function contextWithParentSpan(sc: SpanContext | undefined): Context {
  if (!sc) return ROOT_CONTEXT
  return trace.setSpanContext(ROOT_CONTEXT, sc)
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

/**
 * Passed from `server.upgrade` — `httpSpanContext` is the HTTP GET /ws span so WS handlers share one trace.
 */
type RelaySocketData = { role: "browser" | "agent"; httpSpanContext?: SpanContext }
type RelayWebSocket = ServerWebSocket<RelaySocketData>

/** `relay.ws.open` span context — parent for `relay.message` / `relay.ws.close` on this socket. */
const relayConnParent = new WeakMap<RelayWebSocket, SpanContext>()

export type RequestMsg = {
  id: string
  op: string
  params?: unknown
  /** W3C trace context for distributed tracing (optional). */
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
  console.log(`[univer-sdk-relay] ${message}`, meta ?? {})
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

Bun.serve({
  port,
  fetch(req, server) {
    const url = new URL(req.url)
    let parentCtx = context.active()
    try {
      parentCtx = propagation.extract(context.active(), headersToCarrier(req.headers), textMapGetter)
    } catch {
      /* bad/missing trace headers — continue without parent span */
    }
    return context.with(parentCtx, () => {
      const span = tracer.startSpan(`HTTP ${req.method}`, {
        attributes: { "http.route": url.pathname },
      })
      const active = trace.setSpan(context.active(), span)
      return context.with(active, () => {
        if (url.pathname === "/readyz") {
          span.end()
          return new Response(JSON.stringify({ ok: true, browserConnected: Boolean(browser), agentCount: agents.size }), {
            headers: { "content-type": "application/json; charset=utf-8" },
          })
        }
        if (url.pathname !== "/ws") {
          span.end()
          return new Response("not found", { status: 404 })
        }
        const role = url.searchParams.get("role")
        if (role !== "browser" && role !== "agent") {
          dbg("reject ws upgrade: missing/invalid role", { role: role ?? null, path: url.pathname })
          span.end()
          return new Response("missing role=browser|agent", { status: 400 })
        }
        dbg("ws upgrade attempt", { role, path: url.pathname })
        const upgraded = server.upgrade(req, { data: { role, httpSpanContext: span.spanContext() } })
        dbg("ws upgrade result", { role, upgraded })
        span.end()
        return upgraded ? undefined : new Response("upgrade failed", { status: 500 })
      })
    })
  },
  websocket: {
    data: {} as RelaySocketData,
    open(ws: RelayWebSocket) {
      const id = ++connSeq
      connId.set(ws, id)
      const c = relayAttrs(id, ws.data.role)
      const parentCtx = contextWithParentSpan(ws.data.httpSpanContext)
      tracer.startActiveSpan("relay.ws.open", { attributes: c }, parentCtx, (span) => {
        try {
          relayConnParent.set(ws, span.spanContext())
        } finally {
          span.end()
        }
      })
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
      const text = String(message)
      const payloadLen = text.length
      const cid = connId.get(ws) ?? -1
      const parsed = safeJsonParse(text)
      if (!parsed || typeof parsed !== "object") {
        const parentCtx = contextWithParentSpan(relayConnParent.get(ws))
        tracer.startActiveSpan(
          "relay.message",
          {
            attributes: relayAttrs(cid, ws.data.role, {
              "messaging.operation": "receive",
              "messaging.message_payload_size_bytes": payloadLen,
              error: true,
            }),
          },
          parentCtx,
          (span) => {
            try {
              span.setStatus({ code: SpanStatusCode.ERROR, message: "invalid json" })
            } finally {
              span.end()
            }
          },
        )
        sendJson(ws, { id: "relay", ok: false, error: "invalid json payload" })
        return
      }

      if (ws.data.role === "agent") {
        const req = parsed as Partial<RequestMsg>
        const parentCtx = contextWithParentSpan(relayConnParent.get(ws))
        tracer.startActiveSpan(
          "relay.message",
          {
            attributes: relayAttrs(cid, "agent", {
              "messaging.operation": "receive",
              "messaging.message_id": req.id ?? "",
              "messaging.destination.name": req.op ?? "unknown",
              "messaging.message_payload_size_bytes": payloadLen,
            }),
          },
          parentCtx,
          (msgSpan) => {
            try {
              if (typeof req.traceparent === "string" && req.traceparent.trim()) {
                msgSpan.setAttribute("veritly.incoming.traceparent", req.traceparent.trim())
              }
              if (!req.id || !req.op) {
                sendJson(ws, { id: "relay", ok: false, error: "request must include id and op" })
                msgSpan.setStatus({ code: SpanStatusCode.ERROR, message: "missing id or op" })
                return
              }
              if (!browser) {
                dbg("agent request rejected: no browser", { connId: cid, id: req.id, op: req.op })
                sendJson(ws, { id: req.id, ok: false, error: "browser is not connected" })
                msgSpan.setStatus({ code: SpanStatusCode.ERROR, message: "no browser connected" })
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
              sendJson(browser, forwardToBrowser(req, msgSpan))
            } catch (e) {
              msgSpan.recordException(e as Error)
              msgSpan.setStatus({ code: SpanStatusCode.ERROR })
              throw e
            } finally {
              msgSpan.end()
            }
          },
        )
        return
      }

      const resp = parsed as Partial<ResponseMsg>
      const parentCtx = contextWithParentSpan(relayConnParent.get(ws))
      tracer.startActiveSpan(
        "relay.message",
        {
          attributes: relayAttrs(cid, "browser", {
            "messaging.operation": "receive",
            "messaging.message_id": resp.id ?? "",
            "messaging.message_payload_size_bytes": payloadLen,
            "relay.response_ok": resp.ok ?? false,
          }),
        },
        parentCtx,
        (msgSpan) => {
          try {
            if (typeof resp.traceparent === "string" && resp.traceparent.trim()) {
              msgSpan.setAttribute("veritly.incoming.traceparent", resp.traceparent.trim())
            }
            if (!resp.id) {
              sendJson(ws, { id: "relay", ok: false, error: "response must include id" })
              msgSpan.setStatus({ code: SpanStatusCode.ERROR, message: "missing response id" })
              return
            }
            const target = pending.get(resp.id)
            if (!target) {
              msgSpan.setStatus({
                code: SpanStatusCode.ERROR,
                message: "no pending agent request for this response id",
              })
              msgSpan.addEvent("veritly.relay.unmatched_response", { "veritly.response_id": resp.id })
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
          } catch (e) {
            msgSpan.recordException(e as Error)
            msgSpan.setStatus({ code: SpanStatusCode.ERROR })
            throw e
          } finally {
            msgSpan.end()
          }
        },
      )
    },
    close(ws: RelayWebSocket, code: number, reason: string) {
      const id = connId.get(ws) ?? -1
      const parentCtx = contextWithParentSpan(relayConnParent.get(ws))
      tracer.startActiveSpan(
        "relay.ws.close",
        {
          attributes: relayAttrs(id, ws.data.role, {
            "relay.close_code": code,
            "relay.close_reason_length": String(reason).length,
          }),
        },
        parentCtx,
        (span) => {
          try {
            if (code !== 1000 && code !== 1005) {
              span.setStatus({ code: SpanStatusCode.ERROR, message: `ws closed code=${code}` })
            }
          } finally {
            relayConnParent.delete(ws)
            span.end()
          }
        },
      )
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

console.log(`univer-sdk relay ws://127.0.0.1:${port}/ws?role=agent`)
