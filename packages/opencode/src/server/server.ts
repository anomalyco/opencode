import { generateSpecs } from "hono-openapi"
import { Hono } from "hono"
import { createNodeWebSocket } from "@hono/node-ws"
import { MDNS } from "./mdns"
import { lazy } from "@/util/lazy"
import { createAdaptorServer, type ServerType } from "@hono/node-server"
import { Log } from "@/util/log"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

export namespace Server {
  const log = Log.create({ service: "server" })

  export type Listener = {
    hostname: string
    port: number
    url: URL
    stop: (close?: boolean) => Promise<void>
  }

  export const Default = lazy(() => create({}))

  async function create(opts: { cors?: string[] }) {
    const [
      { AuthMiddleware, CompressionMiddleware, CorsMiddleware, ErrorMiddleware, LoggerMiddleware },
      ,
      { ControlPlaneRoutes },
      { InstanceRoutes },
      { UIRoutes },
    ] = await Promise.all([
      import("./middleware"),
      import("./projectors"),
      import("./control"),
      import("./instance"),
      import("./ui"),
    ])
    const app = new Hono()
    const ws = createNodeWebSocket({ app })
    return {
      app: app
        .onError(ErrorMiddleware)
        .use(AuthMiddleware)
        .use(LoggerMiddleware)
        .use(CompressionMiddleware)
        .use(CorsMiddleware(opts))
        .route("/", ControlPlaneRoutes())
        .route("/", InstanceRoutes(ws.upgradeWebSocket))
        .route("/", UIRoutes()),
      ws,
    }
  }

  export async function openapi() {
    // Build a fresh app with all routes registered directly so
    // hono-openapi can see describeRoute metadata (`.route()` wraps
    // handlers when the sub-app has a custom errorHandler, which
    // strips the metadata symbol).
    const { app } = await create({})
    const result = await generateSpecs(app, {
      documentation: {
        info: {
          title: "opencode",
          version: "1.0.0",
          description: "opencode api",
        },
        openapi: "3.1.1",
      },
    })
    return result
  }

  export let url: URL

  export async function listen(opts: {
    port: number
    hostname: string
    mdns?: boolean
    mdnsDomain?: string
    cors?: string[]
  }): Promise<Listener> {
    const built = await create(opts)
    const start = (port: number) =>
      new Promise<ServerType>((resolve, reject) => {
        const server = createAdaptorServer({ fetch: built.app.fetch })
        built.ws.injectWebSocket(server)
        const fail = (err: Error) => {
          cleanup()
          reject(err)
        }
        const ready = () => {
          cleanup()
          resolve(server)
        }
        const cleanup = () => {
          server.off("error", fail)
          server.off("listening", ready)
        }
        server.once("error", fail)
        server.once("listening", ready)
        server.listen(port, opts.hostname)
      })

    const server = opts.port === 0 ? await start(4096).catch(() => start(0)) : await start(opts.port)
    const addr = server.address()
    if (!addr || typeof addr === "string") {
      throw new Error(`Failed to resolve server address for port ${opts.port}`)
    }

    const next = new URL("http://localhost")
    next.hostname = opts.hostname
    next.port = String(addr.port)
    url = next

    const mdns =
      opts.mdns &&
      addr.port &&
      opts.hostname !== "127.0.0.1" &&
      opts.hostname !== "localhost" &&
      opts.hostname !== "::1"
    if (mdns) {
      MDNS.publish(addr.port, opts.mdnsDomain)
    } else if (opts.mdns) {
      log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
    }

    let closing: Promise<void> | undefined
    return {
      hostname: opts.hostname,
      port: addr.port,
      url: next,
      stop(close?: boolean) {
        closing ??= new Promise((resolve, reject) => {
          if (mdns) MDNS.unpublish()
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
}
