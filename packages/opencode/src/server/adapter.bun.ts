import type { Hono } from "hono"
import { createBunWebSocket } from "hono/bun"
import type { Adapter } from "./adapter"

export const adapter: Adapter = {
  create(app: Hono) {
    const ws = createBunWebSocket()
    return {
      upgradeWebSocket: ws.upgradeWebSocket,
      async listen(opts) {
        const args = {
          fetch: app.fetch,
          hostname: opts.hostname,
          // Default is 10s which is too aggressive for SSE connections.
          // 0 disables the timeout entirely — dead connections (CLOSE_WAIT) are
          // never cleaned up, causing unbounded memory growth. 120s gives the
          // cleanup chain enough time to fire while still bounding leak duration.
          idleTimeout: 120,
          websocket: ws.websocket,
        } as const
        const start = (port: number) => {
          try {
            return Bun.serve({ ...args, port })
          } catch {
            return
          }
        }
        const server = opts.port === 0 ? (start(4096) ?? start(0)) : start(opts.port)
        if (!server) {
          throw new Error(`Failed to start server on port ${opts.port}`)
        }
        if (!server.port) {
          throw new Error(`Failed to resolve server address for port ${opts.port}`)
        }
        return {
          port: server.port,
          stop(close?: boolean) {
            return Promise.resolve(server.stop(close))
          },
        }
      },
    }
  },
}
