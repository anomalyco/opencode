import path from "node:path";

const port = Number(process.env.PORT ?? "80");
const root = path.resolve((process.env.FRONTEND_DIST_DIR ?? "/app/dist").replace(/\/+$/, ""));
const backendHealthUrl = process.env.FRONTEND_BACKEND_HEALTH_URL?.trim() || "http://opencode-api:3000/healthz";
const relayHealthUrl = process.env.FRONTEND_RELAY_HEALTH_URL?.trim() || "http://relay:8080/healthz";
const relayWsHealthUrl = process.env.FRONTEND_RELAY_WS_HEALTH_URL?.trim() || "ws://relay:8080/health/ws";
const publicOpencodeServerUrl =
	process.env.FRONTEND_PUBLIC_OPENCODE_SERVER_URL?.trim() ||
	process.env.VITE_OPENCODE_SERVER_URL?.trim() ||
	"https://api.veritly.co.uk";
const publicUniverBackendUrl =
	process.env.FRONTEND_PUBLIC_UNIVER_BACKEND_URL?.trim() ||
	process.env.VITE_UNIVER_BACKEND_URL?.trim() ||
	"https://univer.veritly.co.uk";
const publicRelayWsUrl =
	process.env.FRONTEND_PUBLIC_UNIVER_SDK_WS?.trim() ||
	process.env.VITE_UNIVER_SDK_WS?.trim() ||
	"wss://relay.veritly.co.uk/ws";
const healthTimeoutMs = Number(process.env.VERITLY_HEALTH_TIMEOUT_MS ?? "5000");

type HealthCheckResult = {
	name: string;
	ok: boolean;
	target: string;
	detail?: string;
	status?: number;
	latencyMs: number;
};

type FrontendHealthReport = {
	service: "opencode-frontend";
	ok: boolean;
	checks: HealthCheckResult[];
};

function trimTrailingSlash(value: string) {
	return value.replace(/\/+$/, "");
}

function toHealthUrl(base: string) {
	return `${trimTrailingSlash(base)}/healthz`;
}

function originOf(base: string) {
	try {
		return new URL(base).origin;
	} catch {
		return base;
	}
}

function relayHttpBaseFromWs(base: string) {
	try {
		const url = new URL(base);
		url.protocol = url.protocol === "wss:" ? "https:" : "http:";
		url.pathname = "";
		url.search = "";
		url.hash = "";
		return url.toString().replace(/\/+$/, "");
	} catch {
		return originOf(base);
	}
}

function toRelayWsHealthUrl(base: string) {
	try {
		const url = new URL(base);
		url.pathname = "/health/ws";
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return base;
	}
}

function timeoutSignal(timeoutMs: number) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
	return {
		signal: controller.signal,
		done() {
			clearTimeout(timer);
		},
	};
}

async function timedHttpCheck(name: string, target: string): Promise<HealthCheckResult> {
	const startedAt = performance.now();
	const timeout = timeoutSignal(healthTimeoutMs);
	try {
		const response = await fetch(target, {
			method: "GET",
			headers: { accept: "application/json, text/plain;q=0.9, */*;q=0.1" },
			signal: timeout.signal,
		});
		return {
			name,
			ok: response.ok,
			target,
			status: response.status,
			detail: response.ok ? "reachable" : `unexpected status ${response.status}`,
			latencyMs: Math.round(performance.now() - startedAt),
		};
	} catch (error) {
		return {
			name,
			ok: false,
			target,
			detail: error instanceof Error ? error.message : String(error),
			latencyMs: Math.round(performance.now() - startedAt),
		};
	} finally {
		timeout.done();
	}
}

async function relayWsCheck(target: string): Promise<HealthCheckResult> {
	const startedAt = performance.now();
	return new Promise((resolve) => {
		let settled = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const socket = new WebSocket(target);

		const finish = (result: Omit<HealthCheckResult, "name" | "target" | "latencyMs">) => {
			if (settled) return;
			settled = true;
			if (timeout) clearTimeout(timeout);
			try {
				if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
					socket.close(1000, "healthcheck complete");
				}
			} catch {}
			resolve({
				name: "relay-websocket",
				target,
				latencyMs: Math.round(performance.now() - startedAt),
				...result,
			});
		};

		timeout = setTimeout(() => {
			finish({ ok: false, detail: "timed out waiting for relay websocket" });
		}, healthTimeoutMs);

		socket.onmessage = (event) => {
			try {
				const payload = JSON.parse(String(event.data));
				if (payload?.ok === true) {
					finish({ ok: true, detail: "websocket probe succeeded" });
					return;
				}
				finish({ ok: false, detail: payload?.error ? String(payload.error) : "unexpected websocket payload" });
			} catch {
				finish({ ok: true, detail: "websocket opened" });
			}
		};

		socket.onerror = () => {
			finish({ ok: false, detail: "websocket error" });
		};

		socket.onclose = (event) => {
			if (settled) return;
			finish({
				ok: event.code === 1000,
				detail: event.code === 1000 ? "websocket probe closed cleanly" : `closed with ${event.code}`,
			});
		};
	});
}

async function staticCheck(): Promise<HealthCheckResult> {
	const target = path.join(root, "index.html");
	const startedAt = performance.now();
	const ok = await Bun.file(target).exists();
	return {
		name: "assets",
		ok,
		target,
		detail: ok ? "index.html present" : "index.html missing",
		latencyMs: Math.round(performance.now() - startedAt),
	};
}

async function frontendHealthReportSimple(): Promise<FrontendHealthReport> {
	const checks = await Promise.all([staticCheck()]);
	return {
		service: "opencode-frontend",
		ok: checks.every((check) => check.ok),
		checks,
	};
}

async function frontendHealthReport(): Promise<FrontendHealthReport> {
	const checks = await Promise.all([
		staticCheck(),
		timedHttpCheck("backend", backendHealthUrl),
		timedHttpCheck("relay-http", relayHealthUrl),
		relayWsCheck(relayWsHealthUrl),
	]);
	return {
		service: "opencode-frontend",
		ok: checks.every((check) => check.ok),
		checks,
	};
}

function escapeHtml(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function healthHtml(report: FrontendHealthReport) {
	const lines = [
		`frontend: ${report.ok ? "OK" : "FAIL"}`,
		"",
		...report.checks.map((check) => {
			return [
				`${check.name}: ${check.ok ? "OK" : "FAIL"}`,
				`  target: ${check.target}`,
				`  latency_ms: ${check.latencyMs}`,
				check.status ? `  status: ${check.status}` : undefined,
				check.detail ? `  detail: ${check.detail}` : undefined,
			]
				.filter(Boolean)
				.join("\n");
		}),
	];

	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Frontend Health</title>
  </head>
  <body>
    <pre>${escapeHtml(lines.join("\n\n"))}</pre>
  </body>
</html>`;
}

function browserHealthHtml() {
	const config = {
		opencodeServerUrl: publicOpencodeServerUrl,
		univerBackendUrl: publicUniverBackendUrl,
		univerSdkWsUrl: publicRelayWsUrl,
		backendHealthUrl: toHealthUrl(publicOpencodeServerUrl),
		relayHealthUrl: toHealthUrl(relayHttpBaseFromWs(publicRelayWsUrl)),
		relayWsHealthUrl: toRelayWsHealthUrl(publicRelayWsUrl),
		timeoutMs: healthTimeoutMs,
	};

	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Frontend Health</title>
  </head>
  <body>
    <pre id="report">running browser checks...</pre>
    <script>
      const config = ${JSON.stringify(config)};
      const reportEl = document.getElementById("report");

      function line(value = "") {
        return String(value);
      }

      function formatReport(report) {
        const lines = [
          "frontend: " + (report.ok ? "OK" : "FAIL"),
          "",
          ...report.checks.flatMap((check) => [
            check.name + ": " + (check.ok ? "OK" : "FAIL"),
            "  target: " + check.target,
            "  latency_ms: " + check.latencyMs,
            check.status ? "  status: " + check.status : null,
            check.detail ? "  detail: " + check.detail : null,
            "",
          ].filter(Boolean)),
        ];
        return lines.join("\\n");
      }

      function timedFetch(name, target, timeoutMs) {
        const startedAt = performance.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        return fetch(target, {
          method: "GET",
          credentials: "omit",
          headers: { accept: "application/json, text/plain;q=0.9, */*;q=0.1" },
          signal: controller.signal,
        })
          .then((response) => ({
            name,
            ok: response.ok,
            target,
            status: response.status,
            detail: response.ok ? "reachable" : "unexpected status " + response.status,
            latencyMs: Math.round(performance.now() - startedAt),
          }))
          .catch((error) => ({
            name,
            ok: false,
            target,
            detail: error instanceof Error ? error.message : String(error),
            latencyMs: Math.round(performance.now() - startedAt),
          }))
          .finally(() => clearTimeout(timer));
      }

      function relayWsCheck(target, timeoutMs) {
        const startedAt = performance.now();
        return new Promise((resolve) => {
          let settled = false;
          let timeout;
          const socket = new WebSocket(target);

          function finish(result) {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            try {
              if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
                socket.close(1000, "healthcheck complete");
              }
            } catch {}
            resolve({
              name: "relay-websocket",
              target,
              latencyMs: Math.round(performance.now() - startedAt),
              ...result,
            });
          }

          timeout = setTimeout(() => finish({ ok: false, detail: "timed out waiting for relay websocket" }), timeoutMs);

          socket.onmessage = (event) => {
            try {
              const payload = JSON.parse(String(event.data));
              if (payload && payload.ok === true) {
                finish({ ok: true, detail: "websocket probe succeeded" });
                return;
              }
              finish({ ok: false, detail: payload && payload.error ? String(payload.error) : "unexpected websocket payload" });
            } catch {
              finish({ ok: true, detail: "websocket opened" });
            }
          };

          socket.onerror = () => finish({ ok: false, detail: "websocket error" });
          socket.onclose = (event) => {
            if (settled) return;
            finish({
              ok: event.code === 1000,
              detail: event.code === 1000 ? "websocket probe closed cleanly" : "closed with " + event.code,
            });
          };
        });
      }

      Promise.all([
        timedFetch("backend", config.backendHealthUrl, config.timeoutMs),
        timedFetch("relay-http", config.relayHealthUrl, config.timeoutMs),
        relayWsCheck(config.relayWsHealthUrl, config.timeoutMs),
      ]).then((checks) => {
        const report = { ok: checks.every((check) => check.ok), checks };
        reportEl.textContent = formatReport(report);
      }).catch((error) => {
        reportEl.textContent = [
          "frontend: FAIL",
          "",
          "health-page: FAIL",
          "  detail: " + (error instanceof Error ? error.message : String(error)),
        ].join("\\n");
      });
    </script>
  </body>
</html>`;
}

function safeJoin(pathname: string) {
	const normalized = pathname === "/" ? "/index.html" : pathname;
	const candidate = path.resolve(path.join(root, normalized.replace(/^\/+/, "")));
	if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return;
	return candidate;
}

async function serveStatic(pathname: string) {
	const candidate = safeJoin(pathname);
	if (!candidate) return new Response("not found", { status: 404 });

	const filePath = (await Bun.file(candidate).exists()) ? candidate : path.join(root, "index.html");
	const file = Bun.file(filePath);
	if (!(await file.exists())) return new Response("not found", { status: 404 });

	if (filePath.endsWith("index.html")) {
		const html = await file.text();
		const runtimeConfig = {
			opencodeServerUrl: publicOpencodeServerUrl,
			univerBackendUrl: publicUniverBackendUrl,
			univerSdkWsUrl: publicRelayWsUrl,
		};
		const injected = html.replace(
			"</head>",
			`<script>window.__VERITLY_RUNTIME_CONFIG__=${JSON.stringify(runtimeConfig)}</script></head>`,
		);
		return new Response(injected, {
			headers: {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-cache",
			},
		});
	}

	return new Response(file, {
		headers: {
			"content-type": file.type || "application/octet-stream",
			"cache-control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
		},
	});
}

Bun.serve({
	port,
	async fetch(req) {
		const url = new URL(req.url);

		if (url.pathname === "/livez") {
			return new Response("ok", {
				headers: { "content-type": "text/plain; charset=utf-8" },
			});
		}

		if (url.pathname === "/healthz") {
			const report = await frontendHealthReportSimple();
			return new Response(JSON.stringify(report), {
				status: report.ok ? 200 : 503,
				headers: { "content-type": "application/json; charset=utf-8" },
			});
		}

		if (url.pathname === "/health.json") {
			const report = await frontendHealthReport();
			return new Response(JSON.stringify(report), {
				status: report.ok ? 200 : 503,
				headers: { "content-type": "application/json; charset=utf-8" },
			});
		}

		if (url.pathname === "/health") {
			return new Response(browserHealthHtml(), {
				status: 200,
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		}

		return serveStatic(url.pathname);
	},
});

console.log(`[veritly-frontend] listening on http://0.0.0.0:${port}`);
