import { context, propagation, trace } from "@opentelemetry/api";
import { createProxyServer } from "http-proxy";
import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { initVeritlyTracer, injectTraceHeaders } from "@veritly/telemetry-veritly";

initVeritlyTracer({ serviceName: "veritly-edge", useAsyncLocalStorage: true });
const tracer = trace.getTracer("veritly-edge");

const port = Number(process.env.PORT || "3000");
const apiBase = "http://127.0.0.1:4096";
const distDir = resolve(process.env.OPENCODE_APP_DIST_DIR || join(process.cwd(), "packages/app/dist"));
const indexFile = join(distDir, "index.html");
const backendUsername = process.env.OPENCODE_SERVER_USERNAME || "opencode";
const backendPassword = process.env.OPENCODE_SERVER_PASSWORD || "";
const wsDebug = process.env.VERITLY_WS_DEBUG === "1";
let wsSeq = 0;

const contentTypes = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".ico": "image/x-icon",
	".webmanifest": "application/manifest+json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".map": "application/json; charset=utf-8",
};

const proxy = createProxyServer({
	target: apiBase,
	changeOrigin: true,
	ws: true,
});

async function backendHealthy() {
	if (!backendPassword) return false;
	try {
		const auth = Buffer.from(`${backendUsername}:${backendPassword}`).toString("base64");
		const res = await fetch(`${apiBase}/global/health`, {
			headers: { authorization: `Basic ${auth}` },
			signal: AbortSignal.timeout(1500),
		});
		return res.ok;
	} catch {
		return false;
	}
}

function backendBasicAuthHeader() {
	if (!backendPassword) return null;
	return `Basic ${Buffer.from(`${backendUsername}:${backendPassword}`).toString("base64")}`;
}

function dbg(message, meta) {
	if (!wsDebug) return;
	console.log(`[serve-custom-app] ${message}`, meta ?? {});
}

function nextWsID() {
	wsSeq += 1;
	return wsSeq;
}

/** @param {import("node:http").IncomingHttpHeaders} h */
function headersToCarrier(h) {
	/** @type {Record<string, string>} */
	const c = {};
	for (const [k, v] of Object.entries(h)) {
		if (v === undefined) continue;
		c[k] = Array.isArray(v) ? v[0] : v;
	}
	return c;
}

function proxyOptsWithTrace(/** @type {Record<string, string>} */ extra) {
	const headers = { ...extra };
	injectTraceHeaders(headers);
	return { headers };
}

/** Public URL still has `/api/`; after strip, forwarded path is `/univer-sdk-relay/...`. */
function isUniverSdkRelayPath(url) {
	const pathOnly = (url || "").split("?")[0];
	return pathOnly.startsWith("/api/univer-sdk-relay") || pathOnly.startsWith("/univer-sdk-relay");
}

/** Browser WebSockets cannot send Authorization; inject OpenCode Basic for relay path only. */
proxy.on("proxyReq", (proxyReq, req) => {
	const p = (req?.url || "").split("?")[0];
	const isRelay = p.startsWith("/univer-sdk-relay") || p.startsWith("/api/univer-sdk-relay");
	if (isRelay) {
		const auth = backendBasicAuthHeader();
		if (auth) proxyReq.setHeader("authorization", auth);
		dbg("proxyReq relay http", { path: p, hasAuthorization: Boolean(auth) });
		return;
	}
	const authorization = proxyReq.getHeader("authorization");
	if (!authorization) proxyReq.removeHeader("authorization");
});

proxy.on("proxyReqWs", (proxyReq, req) => {
	const p = (req?.url || "").split("?")[0];
	const isRelay = p.startsWith("/univer-sdk-relay") || p.startsWith("/api/univer-sdk-relay");
	if (isRelay) {
		const auth = backendBasicAuthHeader();
		if (auth) proxyReq.setHeader("authorization", auth);
		dbg("proxyReq relay ws", {
			wsID: req?.__veritlyWsID ?? null,
			path: p,
			host: req?.headers?.host || "",
			origin: req?.headers?.origin || "",
			hasAuthorization: Boolean(auth),
		});
		return;
	}
	const authorization = proxyReq.getHeader("authorization");
	if (!authorization) proxyReq.removeHeader("authorization");
});

proxy.on("open", (proxySocket) => {
	dbg("proxy ws upstream open", {
		localAddress: proxySocket.localAddress || "",
		localPort: proxySocket.localPort ?? null,
		remoteAddress: proxySocket.remoteAddress || "",
		remotePort: proxySocket.remotePort ?? null,
	});
	proxySocket.on("close", (hadError) => {
		dbg("proxy ws upstream close", { hadError });
	});
	proxySocket.on("error", (error) => {
		dbg("proxy ws upstream error", {
			name: error?.name || "Error",
			message: error?.message || String(error),
		});
	});
});

proxy.on("close", (_res, socket, _head) => {
	dbg("proxy ws downstream close", {
		destroyed: Boolean(socket?.destroyed),
	});
});

proxy.on("error", async (_err, req, res) => {
	dbg("proxy error", { url: req?.url || "", method: req?.method || "unknown" });
	if (!res || ("headersSent" in res && res.headersSent)) return;
	res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify({ message: `Proxy failed for ${req.url ?? "unknown request"}` }));
});

function isAuthorized(req) {
	return typeof req.headers.authorization === "string" && req.headers.authorization.length > 0;
}

function writeUnauthorized(res) {
	res.writeHead(401, {
		"content-type": "text/plain; charset=utf-8",
		"www-authenticate": `Basic realm="${backendUsername}"`,
	});
	res.end("Unauthorized");
}

function staticPath(urlPath) {
	const pathname = (urlPath || "/").split("?")[0];
	const safe = normalize(pathname)
		.replace(/^(\.\.(\/|\\|$))+/, "")
		.replace(/^\/+/, "");
	const target = join(distDir, safe.length === 0 ? "index.html" : safe);
	if (!target.startsWith(distDir)) return null;
	if (existsSync(target) && statSync(target).isFile()) return target;
	return null;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
async function handleHttpRequest(req, res) {
	const url = req.url || "/";
	if (url === "/healthz") {
		const ok = await backendHealthy();
		if (!ok) {
			res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
			res.end("unhealthy");
			return;
		}
		res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
		res.end("ok");
		return;
	}

	// SDK relay WS: browsers do not attach Basic auth to the upgrade; we inject it when proxying.
	if (!isUniverSdkRelayPath(url) && !isAuthorized(req)) {
		writeUnauthorized(res);
		return;
	}

	if (url.startsWith("/api/")) {
		const relay = isUniverSdkRelayPath(url);
		const authHeader = relay ? backendBasicAuthHeader() : null;
		dbg("forward /api request", {
			url,
			relay,
			injectedBasicAuth: Boolean(authHeader),
			hadClientAuth: isAuthorized(req),
		});
		req.url = url.slice(4) || "/";
		const extra = /** @type {Record<string, string>} */ ({});
		if (authHeader) extra.authorization = authHeader;
		proxy.web(req, res, proxyOptsWithTrace(extra));
		return;
	}

	const file = staticPath(url);
	if (file) {
		const type = contentTypes[extname(file)] || "application/octet-stream";
		res.writeHead(200, { "content-type": type });
		createReadStream(file).pipe(res);
		return;
	}

	const html = await readFile(indexFile);
	res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
	res.end(html);
}

/** Default: only trace `/api/*`. Otherwise every JS/CSS chunk emits a span. Set `VERITLY_OTEL_EDGE_HTTP=all` to trace static + SPA. */
function shouldTraceEdgeHttp(url) {
	const pathOnly = (url || "").split("?")[0];
	if (pathOnly === "/healthz") return false;
	if (process.env.VERITLY_OTEL_EDGE_HTTP === "all") return true;
	return pathOnly.startsWith("/api/");
}

function handleWsUpgrade(req, socket, head) {
	const wsID = nextWsID();
	req.__veritlyWsID = wsID;
	dbg("ws upgrade received", {
		wsID,
		url: req.url || "",
		host: req.headers.host || "",
		origin: req.headers.origin || "",
		upgrade: req.headers.upgrade || "",
		connection: req.headers.connection || "",
		headBytes: head?.length ?? 0,
	});
	socket.on("error", (error) => {
		dbg("ws client socket error", {
			wsID,
			name: error?.name || "Error",
			message: error?.message || String(error),
		});
	});
	socket.on("close", (hadError) => {
		dbg("ws client socket close", { wsID, hadError });
	});
	if (!req.url?.startsWith("/api/")) {
		dbg("ws upgrade rejected: non-api path", { wsID, url: req.url || "" });
		socket.destroy();
		return;
	}
	if (!isUniverSdkRelayPath(req.url || "") && !isAuthorized(req)) {
		dbg("ws upgrade rejected: unauthorized", {
			wsID,
			url: req.url || "",
			relay: isUniverSdkRelayPath(req.url || ""),
		});
		socket.write("HTTP/1.1 401 Unauthorized\r\n");
		socket.write(`WWW-Authenticate: Basic realm="${backendUsername}"\r\n`);
		socket.write("Connection: close\r\n\r\n");
		socket.destroy();
		return;
	}
	const relay = isUniverSdkRelayPath(req.url || "");
	const authHeader = relay ? backendBasicAuthHeader() : null;
	dbg("ws upgrade accepted", {
		wsID,
		url: req.url || "",
		relay,
		injectedBasicAuth: Boolean(authHeader),
		hadClientAuth: isAuthorized(req),
	});
	req.url = req.url.slice(4) || "/";
	dbg("ws upgrade forwarding", {
		wsID,
		target: `${apiBase}${req.url}`,
		strippedUrl: req.url,
	});
	const extra = /** @type {Record<string, string>} */ ({});
	if (authHeader) extra.authorization = authHeader;
	try {
		proxy.ws(req, socket, head, proxyOptsWithTrace(extra));
		dbg("ws upgrade proxy.ws dispatched", { wsID, strippedUrl: req.url });
	} catch (error) {
		dbg("ws upgrade proxy.ws threw", {
			wsID,
			name: error?.name || "Error",
			message: error?.message || String(error),
		});
		socket.destroy(error);
	}
}

const server = createServer((req, res) => {
	const url = req.url || "/";
	if (!shouldTraceEdgeHttp(url)) {
		void handleHttpRequest(req, res).catch((e) => {
			console.error("[serve-custom-app]", e);
			if (!res.headersSent) {
				res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
				res.end("Internal Server Error");
			}
		});
		return;
	}
	const carrier = headersToCarrier(req.headers);
	const parentCtx = propagation.extract(context.active(), carrier);
	context.with(parentCtx, () => {
		const span = tracer.startSpan(`HTTP ${req.method || "GET"}`, {
			attributes: {
				"http.target": url,
				"edge.route": url.startsWith("/api/") ? "api" : "static",
			},
		});
		const active = trace.setSpan(context.active(), span);
		let ended = false;
		const safeEnd = () => {
			if (ended) return;
			ended = true;
			span.setAttribute("http.status_code", res.statusCode);
			span.end();
		};
		res.on("finish", safeEnd);
		void context.with(active, async () => {
			try {
				await handleHttpRequest(req, res);
			} catch (e) {
				span.recordException(/** @type {Error} */ (e));
				if (!res.headersSent) {
					res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
					res.end("Internal Server Error");
				}
				safeEnd();
			}
		});
	});
});

server.on("upgrade", (req, socket, head) => {
	if (process.env.VERITLY_OTEL_EDGE_WS !== "1") {
		handleWsUpgrade(req, socket, head);
		return;
	}
	const carrier = headersToCarrier(req.headers);
	const parentCtx = propagation.extract(context.active(), carrier);
	context.with(parentCtx, () => {
		const span = tracer.startSpan("WS upgrade", {
			attributes: { "http.target": req.url || "" },
		});
		const active = trace.setSpan(context.active(), span);
		let wsEnded = false;
		const endWs = () => {
			if (wsEnded) return;
			wsEnded = true;
			span.end();
		};
		socket.once("close", endWs);
		socket.once("error", endWs);
		context.with(active, () => {
			handleWsUpgrade(req, socket, head);
		});
	});
});

server.listen(port, "0.0.0.0", () => {
	console.log(`custom hosted app listening on http://0.0.0.0:${port}`);
});
