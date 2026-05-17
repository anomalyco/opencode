import { createCompatAppFromEnv, headerTestCompatResolver } from "../src/index"

const raw = process.env.PORT?.trim()
if (!raw) throw new Error("PORT is required")
const port = Number.parseInt(raw, 10)
if (Number.isNaN(port)) throw new Error("invalid PORT")

const listenHostRaw = process.env.LISTEN_HOST?.trim()
const hostname =
  listenHostRaw && listenHostRaw.length > 0 ? listenHostRaw : "127.0.0.1"

const app = await createCompatAppFromEnv(headerTestCompatResolver)

Bun.serve({
  hostname,
  port,
  fetch(req, server) {
    const url = new URL(req.url)
    if (
      url.pathname === "/universer-api/comb/connect" &&
      req.headers.get("Upgrade")?.toLowerCase() === "websocket"
    ) {
      const upgraded = server.upgrade(req)
      if (upgraded) return undefined as unknown as Response
      return new Response("WebSocket upgrade failed", { status: 500 })
    }
    return app.fetch(req)
  },
  websocket: {
    open() {},
    message() {},
    close() {},
  },
})

console.log(`[univer-compat] header-test auth listening on http://${hostname}:${port}`)
