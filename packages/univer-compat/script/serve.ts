import { createDefaultCompatApp } from "../src/index"

const stamp = () => new Date().toISOString()

const raw = process.env.PORT?.trim()
if (!raw) throw new Error("PORT is required")
const port = Number.parseInt(raw, 10)
if (Number.isNaN(port)) throw new Error("invalid PORT")

/** `127.0.0.1` = local dev only. Docker / Testcontainers must bind `0.0.0.0` so other containers can reach this process (set `LISTEN_HOST=0.0.0.0`). */
const listenHostRaw = process.env.LISTEN_HOST?.trim()
const hostname = listenHostRaw && listenHostRaw.length > 0 ? listenHostRaw : "127.0.0.1"

console.error(`[univer-compat] ${stamp()} serve: parsed port=${port} hostname=${hostname}`)
console.error(`[univer-compat] ${stamp()} serve: createDefaultCompatApp (S3 ensureReady + app)…`)
const app = await createDefaultCompatApp()
console.error(`[univer-compat] ${stamp()} serve: app ready; Bun.serve…`)

Bun.serve({
  hostname,
  port,
  fetch(req, server) {
    const url = new URL(req.url)
    if (url.pathname === "/universer-api/comb/connect" && req.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const upgraded = server.upgrade(req)
      if (upgraded) return undefined as unknown as Response
      return new Response("WebSocket upgrade failed", { status: 500 })
    }
    return app.fetch(req)
  },
  websocket: {
    /**
     * Univer “comb” = collaboration sync over a WebSocket to `/universer-api/comb/connect`.
     * Production uses binary messages from `@univerjs/protocol` (not “pro” licensing — it is the wire codec).
     * Here we only accept the upgrade so the client does not hard-fail; we do not relay edits between clients.
     */
    open() {},
    message() {},
    close() {},
  },
})

console.error(`[univer-compat] ${stamp()} serve: listening http://${hostname}:${port}`)
console.log(`[univer-compat] listening on http://${hostname}:${port}`)
