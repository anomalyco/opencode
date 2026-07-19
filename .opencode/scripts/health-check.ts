/**
 * Fork-local health/version sidecar for the opencode server.
 *
 * The opencode HTTP server is assembled from high-churn upstream files
 * (`packages/opencode/src/server/routes/instance/httpapi/server.ts` and
 * `groups/global.ts` / `handlers/global.ts`) and exposes no plugin hook for
 * adding raw HTTP routes (the plugin `Hooks` surface covers tools, events,
 * chat, auth — not routes). Modifying those files would break the fork-local
 * "keep changes small and in low-churn files" rule. This sidecar is the
 * sanctioned fallback: a standalone HTTP server that runs alongside opencode
 * and exposes `/health` and `/version` for operational visibility.
 *
 * Run alongside opencode:
 *   bun .opencode/scripts/health-check.ts
 *
 * Configuration (env):
 *   HEALTH_CHECK_PORT          listen port (default 4040)
 *   HEALTH_CHECK_HOST          listen host (default 0.0.0.0)
 *   BUILD_SHA                  git short SHA injected at build time (default "unknown")
 *   BUILD_DATE                 build date injected at build time (default "unknown")
 *   OPENCODE_SERVER_URL        base URL of the real opencode server to probe (optional)
 *                              when set, /health includes `upstream: { ok, status, version }`
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve as pathResolve, join as pathJoin } from "node:path"

const PORT = Number.parseInt(process.env.HEALTH_CHECK_PORT ?? "4040", 10) || 4040
const HOST = process.env.HEALTH_CHECK_HOST ?? "0.0.0.0"
const BUILD_SHA = process.env.BUILD_SHA ?? "unknown"
const BUILD_DATE = process.env.BUILD_DATE ?? "unknown"
const OPENCODE_SERVER_URL = process.env.OPENCODE_SERVER_URL ?? ""

const startedAt = Date.now()

function readOpencodeVersion(): string {
  // Walk up from .opencode/scripts/ to repo root, then packages/opencode/package.json.
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    pathResolve(here, "..", "..", "packages", "opencode", "package.json"),
    pathResolve(here, "..", "..", "package.json"),
  ]
  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { version?: string }
      if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version
    } catch {
      // try next candidate
    }
  }
  return "unknown"
}

const VERSION = readOpencodeVersion()

type UpstreamStatus =
  | { ok: true; status: number; version: string | null }
  | { ok: false; status: number | null; error: string }

async function probeUpstream(signal: AbortSignal): Promise<UpstreamStatus> {
  const url = `${OPENCODE_SERVER_URL.replace(/\/$/, "")}/global/health`
  try {
    const res = await fetch(url, { signal, method: "GET" })
    if (!res.ok) return { ok: false, status: res.status, error: `upstream returned ${res.status}` }
    const body = (await res.json()) as { healthy?: boolean; version?: string }
    if (body.healthy !== true) return { ok: false, status: res.status, error: "upstream not healthy" }
    return { ok: true, status: res.status, version: typeof body.version === "string" ? body.version : null }
  } catch (err) {
    return { ok: false, status: null, error: err instanceof Error ? err.message : String(err) }
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  res.setHeader("Cache-Control", "no-store")
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.end(payload)
}

async function handleHealth(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method Not Allowed" })
    return
  }
  const timestamp = new Date().toISOString()
  const uptime = Math.round((Date.now() - startedAt) / 1000)
  const base = { status: "ok" as const, timestamp, uptime }
  if (!OPENCODE_SERVER_URL) {
    sendJson(res, 200, base)
    return
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2000)
  try {
    const upstream = await probeUpstream(controller.signal)
    sendJson(res, 200, { ...base, upstream })
  } finally {
    clearTimeout(timeout)
  }
}

function handleVersion(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method Not Allowed" })
    return
  }
  // Bun.version is defined on the Bun runtime; fall back to null elsewhere.
  const bunVersion = typeof (globalThis as { Bun?: { version?: string } }).Bun?.version === "string"
    ? (globalThis as { Bun: { version: string } }).Bun.version
    : null
  sendJson(res, 200, {
    version: VERSION,
    buildSha: BUILD_SHA,
    buildDate: BUILD_DATE,
    node: process.versions.node ? `v${process.versions.node}` : "unknown",
    bun: bunVersion ?? "unknown",
  })
}

function handleRoot(req: IncomingMessage, res: ServerResponse): void {
  sendJson(res, 200, {
    service: "opencode-health-sidecar",
    endpoints: ["/health", "/version"],
  })
}

const server = createServer((req, res) => {
  const url = req.url ?? "/"
  const path = url.split("?")[0]
  if (path === "/health") {
    void handleHealth(req, res)
    return
  }
  if (path === "/version") {
    handleVersion(req, res)
    return
  }
  if (path === "/" || path === "") {
    handleRoot(req, res)
    return
  }
  sendJson(res, 404, { error: "Not Found", path })
})

server.listen(PORT, HOST, () => {
  const addr = server.address()
  const binding = typeof addr === "object" && addr !== null ? `${addr.address}:${addr.port}` : `${HOST}:${PORT}`
  // eslint-disable-next-line no-console
  console.log(`opencode health sidecar listening on http://${binding} (version=${VERSION}, buildSha=${BUILD_SHA})`)
})

function shutdown(signal: string): void {
  // eslint-disable-next-line no-console
  console.log(`opencode health sidecar received ${signal}, shutting down`)
  server.close(() => process.exit(0))
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))

export { handleHealth, handleVersion, readOpencodeVersion, probeUpstream }
