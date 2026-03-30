import { timingSafeEqual } from "crypto"
import { Log } from "../util/log"
import { describeRoute, generateSpecs, validator, resolver, openAPIRouteHandler } from "hono-openapi"
import { Hono } from "hono"
import { compress } from "hono/compress"
import { cors } from "hono/cors"
import { basicAuth } from "hono/basic-auth"
import z from "zod"
import { Auth } from "../auth"
import { Flag } from "../flag/flag"
import { ProviderID } from "../provider/schema"
import { WorkspaceRouterMiddleware } from "./router"
import { websocket, getConnInfo } from "hono/bun"
import { errors } from "./error"
import { GlobalRoutes } from "./routes/global"
import { LogRoutes } from "./routes/log"
import { RemoteRoutes } from "./routes/remote"
import { MDNS } from "./mdns"
import { lazy } from "@/util/lazy"
import { errorHandler } from "./middleware"
import { InstanceRoutes } from "./instance"
import { initProjectors } from "./projectors"
import { RemoteAuth } from "./remote-auth"
import { RemoteAccess } from "./remote-access"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

initProjectors()

export namespace Server {
  const log = Log.create({ service: "server" })
  type RemotePair = {
    directory: string
    sessionID?: string
    ttlSeconds?: number
  }

  const zipped = compress()

  const skipCompress = (path: string, method: string) => {
    if (path === "/event" || path === "/global/event" || path === "/global/sync-event") return true
    if (method === "POST" && /\/session\/[^/]+\/(message|prompt_async)$/.test(path)) return true
    return false
  }

  function same(a: string, b: string) {
    const left = Buffer.from(a)
    const right = Buffer.from(b)
    if (left.length !== right.length) return false
    return timingSafeEqual(left, right)
  }

  function basic(header?: string | null) {
    const value = header?.trim() ?? ""
    if (!value) return
    const [scheme, token] = value.split(/\s+/, 2)
    if (!scheme || scheme.toLowerCase() !== "basic" || !token) return
    const raw = Buffer.from(token, "base64").toString()
    const index = raw.indexOf(":")
    if (index < 0) return
    return {
      name: raw.slice(0, index),
      pass: raw.slice(index + 1),
    }
  }

  export const Default = lazy(() => ControlPlaneRoutes())

  export const ControlPlaneRoutes = (opts?: {
    cors?: string[]
    passwordOverride?: string
    usernameOverride?: string
    remoteMode?: RemoteAccess.Mode
    remotePair?: RemotePair
  }): Hono => {
    const app = new Hono()
    return app
      .onError(errorHandler(log))
      .use(async (c, next) => {
        if (opts?.remoteMode) {
          const ip = getConnInfo(c).remote.address
          if (!RemoteAccess.allows(opts.remoteMode, ip)) {
            const text =
              opts.remoteMode === "tailnet"
                ? "Remote access is limited to loopback clients. Use Tailscale Serve to reach this server."
                : "Remote access is limited to private LAN clients."
            return new Response(text, { status: 403 })
          }
        }

        const token = RemoteAuth.isAllowedPath(c.req.path) ? RemoteAuth.tokenFromRequest(c.req.raw) : ""
        if (token) {
          const verified = RemoteAuth.verify(token)
          if (!verified) {
            return c.json(new RemoteAuth.InvalidTokenError({ message: "Invalid or expired remote token" }).toObject(), {
              status: 401,
            }) as unknown as Response
          }
          if (!RemoteAuth.matchesRequest(verified, c.req.raw)) {
            return c.json(
              new RemoteAuth.ScopeError({ message: "Remote token is not valid for this directory" }).toObject(),
              {
                status: 403,
              },
            ) as unknown as Response
          }
          return await next()
        }

        // Allow CORS preflight requests to succeed without auth.
        // Browser clients sending Authorization headers will preflight with OPTIONS.
        if (c.req.method === "OPTIONS") return await next()

        if (opts?.remoteMode && opts.remotePair && c.req.method === "GET" && (c.req.path === "/remote" || c.req.path === "/remote/")) {
          const info = RemoteAuth.create(opts.remotePair)
          const query = new URL(c.req.url).searchParams
          query.set("token", info.token)
          if (info.sessionID) query.set("sessionID", info.sessionID)
          return new Response(null, {
            status: 302,
            headers: {
              location: `?${query.toString()}`,
            },
          })
        }

        const password = opts?.passwordOverride ?? Flag.OPENCODE_SERVER_PASSWORD
        if (!password) return await next()
        const username = opts?.usernameOverride ?? Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
        if (!opts?.remoteMode) {
          return (await basicAuth({ username, password })(c, next)) as Response | void
        }
        const auth = basic(c.req.header("authorization"))
        if (auth && same(auth.name, username) && same(auth.pass, password)) {
          return await next()
        }
        return c.json(
          {
            message:
              "Missing remote token or valid server credentials. Open the full Pairing URL from OpenCode, not the base access URL.",
          },
          { status: 401 },
        ) as unknown as Response
      })
      .use(async (c, next) => {
        const skip = c.req.path === "/log" || c.req.path.startsWith("/log/")
        if (!skip) {
          log.info("request", {
            method: c.req.method,
            path: c.req.path,
          })
        }
        const timer = log.time("request", {
          method: c.req.method,
          path: c.req.path,
        })
        await next()
        if (!skip) {
          timer.stop()
        }
      })
      .use(
        cors({
          maxAge: 86_400,
          origin(input) {
            if (!input) return

            if (input.startsWith("http://localhost:")) return input
            if (input.startsWith("http://127.0.0.1:")) return input
            if (
              input === "tauri://localhost" ||
              input === "http://tauri.localhost" ||
              input === "https://tauri.localhost"
            )
              return input

            // *.opencode.ai (https only, adjust if needed)
            if (/^https:\/\/([a-z0-9-]+\.)*opencode\.ai$/.test(input)) {
              return input
            }
            if (opts?.cors?.includes(input)) {
              return input
            }

            return
          },
        }),
      )
      .use((c, next) => {
        if (skipCompress(c.req.path, c.req.method)) return next()
        return zipped(c, next)
      })
      .route("/global", GlobalRoutes())
      .route("/log", LogRoutes())
      .route("/remote", RemoteRoutes())
      .put(
        "/auth/:providerID",
        describeRoute({
          summary: "Set auth credentials",
          description: "Set authentication credentials",
          operationId: "auth.set",
          responses: {
            200: {
              description: "Successfully set authentication credentials",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator(
          "param",
          z.object({
            providerID: ProviderID.zod,
          }),
        ),
        validator("json", Auth.Info.zod),
        async (c) => {
          const providerID = c.req.valid("param").providerID
          const info = c.req.valid("json")
          await Auth.set(providerID, info)
          return c.json(true)
        },
      )
      .delete(
        "/auth/:providerID",
        describeRoute({
          summary: "Remove auth credentials",
          description: "Remove authentication credentials",
          operationId: "auth.remove",
          responses: {
            200: {
              description: "Successfully removed authentication credentials",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator(
          "param",
          z.object({
            providerID: ProviderID.zod,
          }),
        ),
        async (c) => {
          const providerID = c.req.valid("param").providerID
          await Auth.remove(providerID)
          return c.json(true)
        },
      )
      .get(
        "/doc",
        openAPIRouteHandler(app, {
          documentation: {
            info: {
              title: "opencode",
              version: "0.0.3",
              description: "opencode api",
            },
            openapi: "3.1.1",
          },
        }),
      )
      .use(
        validator(
          "query",
          z.object({
            directory: z.string().optional(),
            workspace: z.string().optional(),
          }),
        ),
      )
      .use(WorkspaceRouterMiddleware)
  }

  export function createApp(opts: {
    cors?: string[]
    passwordOverride?: string
    usernameOverride?: string
    remoteMode?: RemoteAccess.Mode
    remotePair?: RemotePair
  }) {
    return ControlPlaneRoutes(opts)
  }

  export async function openapi() {
    // Build a fresh app with all routes registered directly so
    // hono-openapi can see describeRoute metadata (`.route()` wraps
    // handlers when the sub-app has a custom errorHandler, which
    // strips the metadata symbol).
    const app = ControlPlaneRoutes()
    InstanceRoutes(app)
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

  /** @deprecated do not use this dumb shit */
  export let url: URL

  export function listen(opts: {
    port: number
    hostname: string
    mdns?: boolean
    mdnsDomain?: string
    cors?: string[]
    passwordOverride?: string
    usernameOverride?: string
    remoteMode?: RemoteAccess.Mode
    remotePair?: RemotePair
  }) {
    url = new URL(`http://${opts.hostname}:${opts.port}`)
    const app = ControlPlaneRoutes({
      cors: opts.cors,
      passwordOverride: opts.passwordOverride,
      usernameOverride: opts.usernameOverride,
      remoteMode: opts.remoteMode,
      remotePair: opts.remotePair,
    })
    const args = {
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: app.fetch,
      websocket: websocket,
    } as const
    const tryServe = (port: number) => {
      try {
        return Bun.serve({ ...args, port })
      } catch {
        return undefined
      }
    }
    const server = opts.port === 0 ? (tryServe(4096) ?? tryServe(0)) : tryServe(opts.port)
    if (!server) throw new Error(`Failed to start server on port ${opts.port}`)

    const shouldPublishMDNS =
      opts.mdns &&
      server.port &&
      opts.hostname !== "127.0.0.1" &&
      opts.hostname !== "localhost" &&
      opts.hostname !== "::1"
    if (shouldPublishMDNS) {
      MDNS.publish(server.port!, opts.mdnsDomain)
    } else if (opts.mdns) {
      log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
    }

    const originalStop = server.stop.bind(server)
    server.stop = async (closeActiveConnections?: boolean) => {
      if (shouldPublishMDNS) MDNS.unpublish()
      return originalStop(closeActiveConnections)
    }

    return server
  }
}
