import {
	context,
	propagation,
	trace,
	SpanStatusCode,
	type Context,
	type Span,
	type TextMapGetter,
} from "@opentelemetry/api"
import { Hono } from "hono"
import { upgradeWebSocket } from "hono/bun"
import { lazy } from "@/util/lazy"

const tracer = trace.getTracer("veritly-univer-sdk-relay")

const MESSAGING_SYSTEM = "veritly_univer_relay"

const textMapGetter: TextMapGetter<Record<string, string>> = {
	get(carrier: Record<string, string>, key: string) {
		return carrier[key]
	},
	keys(carrier: Record<string, string>) {
		return Object.keys(carrier)
	},
}

function contextFromOptionalTraceparent(tp: string | undefined): Context {
	const t = tp?.trim()
	if (!t) return context.active()
	try {
		return propagation.extract(context.active(), { traceparent: t }, textMapGetter)
	} catch {
		return context.active()
	}
}

function relayAttrs(connId: number, role: string, extra?: Record<string, string | number | boolean>) {
	return {
		"messaging.system": MESSAGING_SYSTEM,
		"network.transport": "websocket",
		"veritly.relay.conn_id": connId,
		"veritly.relay.role": role,
		...extra,
	}
}

function safeJsonParse(text: string): unknown | null {
	try {
		return JSON.parse(text)
	} catch {
		return null
	}
}

function relayPort(): number {
	const raw = process.env.UNIVER_SDK_PORT?.trim()
	return raw ? Number(raw) : 18766
}

const wsDebug = process.env.VERITLY_WS_DEBUG === "1"
let bridgeConnSeq = 0

function dbg(message: string, meta?: Record<string, unknown>) {
	if (!wsDebug) return
	console.log(`[opencode-univer-sdk-bridge] ${message}`, meta ?? {})
}

/**
 * Single Bun relay (`packages/univer-sdk/script/sdk-relay.ts`) owns the logic; this is only a
 * WebSocket/HTTP shim on OpenCode. `127.0.0.1` here is server-side loopback (same host as this process).
 * Browsers on Railway hit `wss://…/api/univer-sdk-relay/ws` → OpenCode → `ws://127.0.0.1:PORT/ws`.
 */
export const UniverSdkRelayRoutes = lazy(() => {
	const app = new Hono()

	app.get("/health", async (c) => {
		const res = await fetch(`http://127.0.0.1:${relayPort()}/health`, {
			signal: AbortSignal.timeout(3000),
		})
		if (!res.ok) {
			return c.text("univer sdk relay unreachable", 502)
		}
		const body = await res.text()
		return new Response(body, {
			status: res.status,
			headers: {
				"content-type": res.headers.get("content-type") ?? "application/json; charset=utf-8",
			},
		})
	})

	app.get(
		"/ws",
		upgradeWebSocket(async (c) => {
			const qs = new URL(c.req.url).search
			const role = new URL(c.req.url).searchParams.get("role") ?? "unknown"
			const connId = ++bridgeConnSeq
			let upstream: WebSocket | null = null

			return {
				onOpen(_event, ws) {
					dbg("client ws open", { connId, role, qs })
					tracer.startActiveSpan("relay.ws.open", { attributes: relayAttrs(connId, role) }, (span) => {
						span.end()
					})

					const u = new WebSocket(`ws://127.0.0.1:${relayPort()}/ws${qs}`)
					upstream = u

					u.addEventListener("message", (ev) => {
						const d = ev.data
						dbg("upstream -> client", { connId, role, dataType: typeof d })

						const forward = () => {
							if (typeof d === "string") ws.send(d)
							else if (d instanceof ArrayBuffer) ws.send(d)
							else if (d instanceof Blob) {
								void d.arrayBuffer().then((buf) => ws.send(buf))
							}
						}

						if (typeof d !== "string") {
							const len =
								d instanceof ArrayBuffer ? d.byteLength : d instanceof Blob ? undefined : String(d).length
							tracer.startActiveSpan(
								"relay.message",
								{
									attributes: relayAttrs(connId, role, {
										"messaging.operation": "receive",
										"veritly.relay.bridge_direction": "upstream_to_client",
										...(typeof len === "number"
											? { "messaging.message_payload_size_bytes": len }
											: {}),
									}),
								},
								(span) => {
									try {
										forward()
									} finally {
										span.end()
									}
								},
							)
							return
						}

						const payloadLen = d.length
						const parsed = safeJsonParse(d)
						if (!parsed || typeof parsed !== "object") {
							tracer.startActiveSpan(
								"relay.message",
								{
									attributes: relayAttrs(connId, role, {
										"messaging.operation": "receive",
										"veritly.relay.bridge_direction": "upstream_to_client",
										"messaging.message_payload_size_bytes": payloadLen,
										error: true,
									}),
								},
								(span: Span) => {
									try {
										span.setStatus({ code: SpanStatusCode.ERROR, message: "invalid json" })
										forward()
									} finally {
										span.end()
									}
								},
							)
							return
						}

						const o = parsed as Record<string, unknown>
						const tp = typeof o.traceparent === "string" ? o.traceparent : undefined
						const parentCtx = contextFromOptionalTraceparent(tp)

						if (role === "browser" && typeof o.id === "string" && typeof o.op === "string") {
							const mid = o.id
							const mop = o.op
							context.with(parentCtx, () => {
								tracer.startActiveSpan(
									"relay.message",
									{
										attributes: relayAttrs(connId, "browser", {
											"messaging.operation": "receive",
											"messaging.message_id": mid,
											"messaging.destination.name": mop,
											"messaging.message_payload_size_bytes": payloadLen,
											"veritly.relay.bridge_direction": "upstream_to_client",
										}),
									},
									(span) => {
										try {
											forward()
										} finally {
											span.end()
										}
									},
								)
							})
							return
						}

						if (role === "agent" && typeof o.id === "string" && typeof o.ok === "boolean") {
							const mid = o.id
							const rok = o.ok
							context.with(parentCtx, () => {
								tracer.startActiveSpan(
									"relay.message",
									{
										attributes: relayAttrs(connId, "agent", {
											"messaging.operation": "receive",
											"messaging.message_id": mid,
											"messaging.message_payload_size_bytes": payloadLen,
											"relay.response_ok": rok,
											"veritly.relay.bridge_direction": "upstream_to_client",
										}),
									},
									(span) => {
										try {
											forward()
										} finally {
											span.end()
										}
									},
								)
							})
							return
						}

						tracer.startActiveSpan(
							"relay.message",
							{
								attributes: relayAttrs(connId, role, {
									"messaging.operation": "receive",
									"messaging.message_payload_size_bytes": payloadLen,
									"veritly.relay.bridge_direction": "upstream_to_client",
								}),
							},
							(span) => {
								try {
									forward()
								} finally {
									span.end()
								}
							},
						)
					})

					u.addEventListener("close", (ev) => {
						dbg("upstream ws close", { connId, role, code: ev.code, reason: ev.reason || "" })
						ws.close(ev.code, ev.reason)
					})

					u.addEventListener("error", () => {
						dbg("upstream ws error", { connId, role })
						ws.close(1011, "upstream relay error")
					})
				},
				onMessage(event) {
					const u = upstream
					if (!u) return
					const d = event.data
					dbg("client -> upstream", { connId, role, dataType: typeof d })

					const send = () => {
						if (typeof d === "string") u.send(d)
						else if (d instanceof ArrayBuffer) u.send(d)
						else u.send(String(d))
					}

					if (typeof d !== "string") {
						const len =
							d instanceof ArrayBuffer ? d.byteLength : d instanceof Blob ? undefined : String(d).length
						tracer.startActiveSpan(
							"relay.message",
							{
								attributes: relayAttrs(connId, role, {
									"messaging.operation": "receive",
									"veritly.relay.bridge_direction": "client_to_upstream",
									...(typeof len === "number"
										? { "messaging.message_payload_size_bytes": len }
										: {}),
								}),
							},
							(span) => {
								try {
									if (u.readyState === WebSocket.OPEN) send()
									else u.addEventListener("open", send, { once: true })
								} finally {
									span.end()
								}
							},
						)
						return
					}

					const payloadLen = d.length
					const parsed = safeJsonParse(d)
					if (!parsed || typeof parsed !== "object") {
						tracer.startActiveSpan(
							"relay.message",
							{
								attributes: relayAttrs(connId, role, {
									"messaging.operation": "receive",
									"veritly.relay.bridge_direction": "client_to_upstream",
									"messaging.message_payload_size_bytes": payloadLen,
									error: true,
								}),
							},
							(span: Span) => {
								try {
									span.setStatus({ code: SpanStatusCode.ERROR, message: "invalid json" })
									if (u.readyState === WebSocket.OPEN) send()
									else u.addEventListener("open", send, { once: true })
								} finally {
									span.end()
								}
							},
						)
						return
					}

					const o = parsed as Record<string, unknown>
					const tp = typeof o.traceparent === "string" ? o.traceparent : undefined
					const parentCtx = contextFromOptionalTraceparent(tp)

					if (role === "agent" && typeof o.id === "string" && typeof o.op === "string") {
						const mid = o.id
						const mop = o.op
						context.with(parentCtx, () => {
							tracer.startActiveSpan(
								"relay.message",
								{
									attributes: relayAttrs(connId, "agent", {
										"messaging.operation": "receive",
										"messaging.message_id": mid,
										"messaging.destination.name": mop,
										"messaging.message_payload_size_bytes": payloadLen,
										"veritly.relay.bridge_direction": "client_to_upstream",
									}),
								},
								(span) => {
									try {
										if (u.readyState === WebSocket.OPEN) send()
										else u.addEventListener("open", send, { once: true })
									} finally {
										span.end()
									}
								},
							)
						})
						return
					}

					if (role === "browser" && typeof o.id === "string" && typeof o.ok === "boolean") {
						const mid = o.id
						const rok = o.ok
						context.with(parentCtx, () => {
							tracer.startActiveSpan(
								"relay.message",
								{
									attributes: relayAttrs(connId, "browser", {
										"messaging.operation": "receive",
										"messaging.message_id": mid,
										"messaging.message_payload_size_bytes": payloadLen,
										"relay.response_ok": rok,
										"veritly.relay.bridge_direction": "client_to_upstream",
									}),
								},
								(span) => {
									try {
										if (u.readyState === WebSocket.OPEN) send()
										else u.addEventListener("open", send, { once: true })
									} finally {
										span.end()
									}
								},
							)
						})
						return
					}

					tracer.startActiveSpan(
						"relay.message",
						{
							attributes: relayAttrs(connId, role, {
								"messaging.operation": "receive",
								"messaging.message_payload_size_bytes": payloadLen,
								"veritly.relay.bridge_direction": "client_to_upstream",
							}),
						},
						(span) => {
							try {
								if (u.readyState === WebSocket.OPEN) send()
								else u.addEventListener("open", send, { once: true })
							} finally {
								span.end()
							}
						},
					)
				},
				onClose() {
					dbg("client ws close", { connId, role })
					tracer.startActiveSpan(
						"relay.ws.close",
						{
							attributes: relayAttrs(connId, role, {
								"relay.close_reason_length": 0,
							}),
						},
						(span) => {
							span.end()
						},
					)
					upstream?.close()
					upstream = null
				},
			}
		}),
	)

	return app
})
