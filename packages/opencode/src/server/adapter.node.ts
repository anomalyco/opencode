import { EventEmitter } from "node:events"
import { createAdaptorServer, type ServerType } from "@hono/node-server"
import { createNodeWebSocket } from "@hono/node-ws"
import type { Hono } from "hono"
import type { Adapter, FetchApp, Opts } from "./adapter"

async function listen(app: FetchApp, opts: Opts, inject?: (server: ServerType) => void) {
  const start = (port: number) =>
    new Promise<ServerType>((resolve, reject) => {
      const server = createAdaptorServer({ fetch: app.fetch })
      const events = server as EventEmitter
      inject?.(server)
      const fail = (err: Error) => {
        cleanup()
        reject(err)
      }
      const ready = () => {
        cleanup()
        resolve(server)
      }
      const cleanup = () => {
        events.off("error", fail)
        events.off("listening", ready)
      }
      events.once("error", fail)
      events.once("listening", ready)
      server.listen(port, opts.hostname)
    })

  const server = opts.port === 0 ? await start(4096).catch(() => start(0)) : await start(opts.port)
  const addr = server.address()
  if (!addr || typeof addr === "string") {
    throw new Error(`Failed to resolve server address for port ${opts.port}`)
  }

  let closing: Promise<void> | undefined
  return {
    port: addr.port,
    stop(close?: boolean) {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err)
            return
          }
          resolve()
        })
        if (close) {
          if ("closeAllConnections" in server && typeof server.closeAllConnections === "function") {
            server.closeAllConnections()
          }
          if ("closeIdleConnections" in server && typeof server.closeIdleConnections === "function") {
            server.closeIdleConnections()
          }
        }
      })
      return closing
    },
  }
}

export const adapter: Adapter = {
  create(app: Hono) {
    const ws = createNodeWebSocket({ app })
    return {
      upgradeWebSocket: ws.upgradeWebSocket,
      listen: (opts) => listen(app, opts, ws.injectWebSocket),
    }
  },
  createFetch(app) {
    return {
      listen: (opts) => listen(app, opts),
    }
  },
}
