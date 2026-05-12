import http from "node:http"
import httpProxy from "http-proxy"
import { handleApi } from "./api.js"
import { config } from "./config.js"
import * as devProxy from "./dev-proxy.js"
import {
  deleteIdlePods,
  getPodIP,
  updateLastActivity,
  restorePodSecrets,
  getOrCreateAttachPassword,
} from "./pod-manager.js"
import { serveStatic } from "./static.js"

/**
 * Extract session hash and optional port from the Host header.
 * Returns {hash, port} where port is either a number >3000 (for dev servers) or null (defaults to config.opencodePort).
 *
 * Session hostname format:
 *   <hash>-oc.<domain>         → hash only (defaults to port 4096)
 *   <port>-<hash>-oc.<domain>  → explicit dev server port (e.g., 5173-abc123... → port 5173)
 *
 * With ROUTE_SUFFIX="" (local dev, ROUTER_DOMAIN="localhost:3002"):
 *   abc123-oc.localhost:3002       → hash, port 4096
 *   5173-abc123-oc.localhost:3002 → hash, port 5173
 */
function getSessionInfo(host: string): { hash: string | null; port: number | null } {
  // Strip port from both the incoming Host header and routerDomain before comparing
  const hostname = host.split(":")[0]
  const routerHostname = config.routerDomain.split(":")[0]
  const suffix = `${config.routeSuffix}.${routerHostname}`
  if (!hostname.endsWith(suffix)) return { hash: null, port: null }

  const sub = hostname.slice(0, hostname.length - suffix.length)

  // Check for <port>-<hash> pattern (port is 4+ digits at start)
  const portMatch = sub.match(/^([1-9][0-9]{3,})-(.+)$/)
  if (portMatch) {
    const port = parseInt(portMatch[1], 10)
    const hashPart = portMatch[2]
    if (/^[a-f0-9]{12}$/.test(hashPart)) {
      return { hash: hashPart, port }
    }
  }

  // Default: just <hash>
  if (/^[a-f0-9]{12}$/.test(sub)) {
    return { hash: sub, port: null }
  }

  return { hash: null, port: null }
}

/**
 * Extract attach session hash from the Host header.
 * Returns the hash if the request is on an attach subdomain, or null otherwise.
 *
 * Attach hostname format: <attachRoutePrefix><hash><routeSuffix>.<routerDomain>
 * e.g. with attachRoutePrefix="attach-", routeSuffix="-oc", routerDomain="no-panic.org":
 *   attach-abc123def456-oc.no-panic.org → "abc123def456"
 */
function getAttachSessionHash(host: string): string | null {
  const hostname = host.split(":")[0]
  const routerHostname = config.routerDomain.split(":")[0]
  const suffix = `${config.routeSuffix}.${routerHostname}`
  const prefix = config.attachRoutePrefix

  if (!hostname.endsWith(suffix) || !hostname.startsWith(prefix)) return null

  const hashPart = hostname.slice(prefix.length, hostname.length - suffix.length)
  if (/^[a-f0-9]{12}$/.test(hashPart)) return hashPart
  return null
}

/**
 * Validate attach password from request.
 * Checks (in order):
 *   1. HTTP Basic Auth header (used by `opencode attach --password`)
 *   2. Query parameter ?password=
 *   3. X-Attach-Password header
 * Compares against the stored password in PVC annotation.
 */
async function validateAttachPassword(hash: string, req: http.IncomingMessage): Promise<boolean> {
  // 1. HTTP Basic Auth (Authorization: Basic base64("opencode:<password>"))
  const authHeader = req.headers["authorization"]
  let providedPassword: string | undefined
  if (typeof authHeader === "string" && authHeader.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8")
    const colonIdx = decoded.indexOf(":")
    if (colonIdx !== -1) providedPassword = decoded.slice(colonIdx + 1)
  }

  // 2. Query param or custom header as fallback
  if (!providedPassword) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`)
    const queried = url.searchParams.get("password") ?? req.headers["x-attach-password"]
    if (typeof queried === "string") providedPassword = queried
  }

  if (!providedPassword) return false

  try {
    const storedPassword = await getOrCreateAttachPassword(hash)
    return storedPassword === providedPassword
  } catch {
    return false
  }
}

function getEmail(req: http.IncomingMessage): string | null {
  const header = req.headers["x-auth-request-email"]
  if (typeof header === "string" && header.length > 0) return header
  if (config.devEmail) return config.devEmail
  return null
}

function getGithubToken(req: http.IncomingMessage): string | undefined {
  const header =
    req.headers["x-auth-request-access-token"] ??
    req.headers["x-auth-request-token"] ??
    req.headers["x-forwarded-access-token"]
  return typeof header === "string" && header.length > 0 ? header : undefined
}

async function proxyToPod(
  hash: string,
  port: number | null,
  req: http.IncomingMessage,
  res?: http.ServerResponse,
  socket?: import("stream").Duplex,
  head?: Buffer,
): Promise<boolean> {
  const targetPort = port ?? config.opencodePort
  let target: string | null = null
  if (devProxy.enabled) {
    target = await devProxy.target(hash)
  } else {
    const ip = await getPodIP(hash)
    if (ip) target = `http://${ip}:${targetPort}`
  }
  if (!target) return false

  updateLastActivity(hash)
  if (socket && head) {
    proxy.ws(req, socket, head, { target, changeOrigin: true })
  } else if (res) {
    proxy.web(req, res, { target, changeOrigin: true })
  }
  return true
}

const proxy = httpProxy.createProxyServer({})

proxy.on("error", (err, _req, res) => {
  console.error("Proxy error:", err.message)
  if (res instanceof http.ServerResponse && !res.headersSent) {
    res.writeHead(502).end("Bad Gateway")
  }
})

// ── Shared HTTP request handler ─────────────────────────────────────────
// Used by both the main server (port 3000, behind oauth2-proxy) and the
// attach server (port 4096, NOT behind oauth2-proxy).
//
// Request flow:
//   1. Admin endpoints (skip email check, use admin secret)
//   2. Pod push endpoints (skip email check, use pod secret)
//   3. Attach subdomain (skip email check, use password auth)
//   4. Everything else: require email (OAuth from oauth2-proxy)
const handler: http.RequestListener = async (req, res) => {
  if (config.debugHeaders) {
    console.log(
      `[debug] ${req.method} ${req.headers.host}${req.url} email=${req.headers["x-auth-request-email"] ?? "MISSING"} token=${req.headers["x-auth-request-access-token"] ? "PRESENT" : "MISSING"}`,
    )
  }

  const url = req.url ?? "/"
  const host = req.headers.host ?? ""

  // ── Admin endpoints: check admin secret BEFORE email check ─────────
  const isAdminEndpoint = url.startsWith("/api/admin/")
  if (isAdminEndpoint && req.method === "POST" && config.adminSecret) {
    const providedSecret = req.headers["x-admin-secret"]
    if (providedSecret === config.adminSecret) {
      if (await handleApi(req, res, "admin@localhost", undefined)) return
    }
  }

  // ── Pod pushes: POST /api/sessions/:hash/progress and /ports ───────
  if (/^\/api\/sessions\/[a-f0-9]{12}\/(progress|ports)$/.test(url) && req.method === "POST") {
    if (await handleApi(req, res, "pod@localhost", undefined)) return
  }

  // ── Operator port poll: GET /api/sessions/:hash/ports requires admin secret ─
  const isPortsGet = /^\/api\/sessions\/[a-f0-9]{12}\/ports$/.test(url) && req.method === "GET"
  if (isPortsGet && config.adminSecret) {
    const providedSecret = req.headers["x-admin-secret"]
    if (providedSecret !== config.adminSecret) {
      res.writeHead(403, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Forbidden" }))
      return
    }
    if (await handleApi(req, res, "admin@localhost", undefined)) return
  }

  // ── Attach subdomain: password-based auth (bypasses OAuth) ─────────
  const attachHash = getAttachSessionHash(host)
  if (attachHash) {
    const passwordValid = await validateAttachPassword(attachHash, req)
    if (!passwordValid) {
      res
        .writeHead(401, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: "Invalid or missing attach password" }))
      return
    }
    if (!(await proxyToPod(attachHash, null, req, res))) {
      res
        .writeHead(503, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: "session not ready", hash: attachHash }))
    }
    return
  }

  // ── Everything else requires OAuth (email from oauth2-proxy) ──────
  const email = getEmail(req)
  if (!email) {
    res.writeHead(401, { "Content-Type": "text/plain" }).end("Missing user identity")
    return
  }

  try {
    const { hash, port } = getSessionInfo(host)

    if (hash) {
      if (!(await proxyToPod(hash, port, req, res))) {
        res
          .writeHead(503, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: "session not ready", hash }))
      }
      return
    }

    // ── Root domain: API + SPA ──────────────────────────────────────
    if (url.startsWith("/api/")) {
      if (await handleApi(req, res, email, getGithubToken(req))) return
    }

    if (config.devViteUrl) {
      proxy.web(req, res, { target: config.devViteUrl })
    } else {
      serveStatic(config.publicDir, req, res)
    }
  } catch (err) {
    console.error(`Error handling request for ${req.headers.host}:`, err)
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" }).end("Internal server error")
    }
  }
}

// ── Shared WebSocket upgrade handler ──────────────────────────────────────
const wsHandler: http.RequestListener = async (req, socket, head) => {
  const url = req.url ?? "/"
  if (url.startsWith("/api/admin/")) {
    socket.destroy()
    return
  }

  // Attach subdomain: password-based auth (bypasses OAuth)
  const attachHash = getAttachSessionHash(req.headers.host ?? "")
  if (attachHash) {
    const passwordValid = await validateAttachPassword(attachHash, req)
    if (!passwordValid) {
      socket.destroy()
      return
    }
    if (!(await proxyToPod(attachHash, null, req, undefined, socket, head))) {
      socket.destroy()
    }
    return
  }

  // Everything else requires OAuth
  const email = getEmail(req)
  if (!email) {
    socket.destroy()
    return
  }

  try {
    const host = req.headers.host ?? ""
    const { hash, port } = getSessionInfo(host)

    if (hash) {
      if (!(await proxyToPod(hash, port, req, undefined, socket, head))) {
        socket.destroy()
      }
      return
    }

    // WebSocket on root domain — Vite HMR in dev mode
    if (config.devViteUrl) {
      proxy.ws(req, socket, head, { target: config.devViteUrl })
      return
    }

    socket.destroy()
  } catch (err) {
    console.error(`WebSocket upgrade error for ${req.headers.host}:`, err)
    socket.destroy()
  }
}

// ── Create server instances ─────────────────────────────────────────────
// Both servers share the same handler and wsHandler so all routes work on
// both ports. In production:
//   - Port 3000 is behind oauth2-proxy: OAuth required, attach routes blocked
//   - Port 4096 is NOT behind oauth2-proxy: attach routes work with password
const server = http.createServer(handler)
server.on("upgrade", wsHandler)

const attachServer = http.createServer(handler)
attachServer.on("upgrade", wsHandler)

// Background: clean up idle pods every 60 seconds
const cleanupInterval = setInterval(deleteIdlePods, 60_000)

function shutdown() {
  console.log("Shutting down...")
  clearInterval(cleanupInterval)
  devProxy.cleanup()
  server.close()
  attachServer.close()
  setTimeout(() => process.exit(0), 5_000)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

server.listen(config.port, () => {
  console.log(`opencode-router listening on :${config.port} | domain: ${config.routerDomain}`)
  restorePodSecrets().catch((err) => console.error("Failed to restore pod secrets:", err))
})

// Start attach server on the configured attach port
// This port should NOT be behind oauth2-proxy so attach subdomain requests
// can bypass OAuth and use password-based auth instead.
if (config.attachPort !== config.port) {
  attachServer.listen(config.attachPort, () => {
    console.log(`opencode-router attach server listening on :${config.attachPort}`)
  })
} else {
  console.warn(
    `Attach port (${config.attachPort}) is same as main port (${config.port}). Attach server not started separately.`,
  )
}
