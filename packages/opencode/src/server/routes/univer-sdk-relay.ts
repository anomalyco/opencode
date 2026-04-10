import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { lazy } from "@/util/lazy";

function relayPort(): number {
	return Number(process.env.UNIVER_SDK_PORT ?? "18766");
}

const wsDebug = process.env.VERITLY_WS_DEBUG === "1";
let bridgeConnSeq = 0;

function dbg(message: string, meta?: Record<string, unknown>) {
	if (!wsDebug) return;
	console.log(`[opencode-univer-sdk-bridge] ${message}`, meta ?? {});
}

/**
 * Single Bun relay (`packages/univer-sdk/script/sdk-relay.ts`) owns the logic; this is only a
 * WebSocket/HTTP shim on OpenCode. `127.0.0.1` here is server-side loopback (same host as this process).
 * Browsers on Railway hit `wss://…/api/univer-sdk-relay/ws` → OpenCode → `ws://127.0.0.1:PORT/ws`.
 */
export const UniverSdkRelayRoutes = lazy(() => {
	const app = new Hono();

	app.get("/health", async (c) => {
		const res = await fetch(`http://127.0.0.1:${relayPort()}/health`, {
			signal: AbortSignal.timeout(3000),
		});
		if (!res.ok) {
			return c.text("univer sdk relay unreachable", 502);
		}
		const body = await res.text();
		return new Response(body, {
			status: res.status,
			headers: {
				"content-type": res.headers.get("content-type") ?? "application/json; charset=utf-8",
			},
		});
	});

	app.get(
		"/ws",
		upgradeWebSocket(async (c) => {
			const qs = new URL(c.req.url).search;
			const role = new URL(c.req.url).searchParams.get("role") ?? "unknown";
			const connId = ++bridgeConnSeq;
			let upstream: WebSocket | null = null;

			return {
				onOpen(_event, ws) {
					dbg("client ws open", { connId, role, qs });
					const u = new WebSocket(`ws://127.0.0.1:${relayPort()}/ws${qs}`);
					upstream = u;

					u.addEventListener("message", (ev) => {
						const d = ev.data;
						dbg("upstream -> client", { connId, role, dataType: typeof d });
						if (typeof d === "string") ws.send(d);
						else if (d instanceof ArrayBuffer) ws.send(d);
						else if (d instanceof Blob) {
							void d.arrayBuffer().then((buf) => ws.send(buf));
						}
					});

					u.addEventListener("close", (ev) => {
						dbg("upstream ws close", { connId, role, code: ev.code, reason: ev.reason || "" });
						ws.close(ev.code, ev.reason);
					});

					u.addEventListener("error", () => {
						dbg("upstream ws error", { connId, role });
						ws.close(1011, "upstream relay error");
					});
				},
				onMessage(event) {
					const u = upstream;
					if (!u) return;
					const d = event.data;
					dbg("client -> upstream", { connId, role, dataType: typeof d });
					const send = () => {
						if (typeof d === "string") u.send(d);
						else if (d instanceof ArrayBuffer) u.send(d);
						else u.send(String(d));
					};
					if (u.readyState === WebSocket.OPEN) send();
					else u.addEventListener("open", send, { once: true });
				},
				onClose() {
					dbg("client ws close", { connId, role });
					upstream?.close();
					upstream = null;
				},
			};
		}),
	);

	return app;
});
