import { generateSpecs } from "hono-openapi"
import { Hono } from "hono"
import { adapter } from "#hono"
import { lazy } from "@/util/lazy"
import { Log } from "@/util"
import { Flag } from "@opencode-ai/core/flag/flag"
import { WorkspaceID } from "@/control-plane/schema"
import { MDNS } from "./mdns"
import { AuthMiddleware, CompressionMiddleware, CorsMiddleware, ErrorMiddleware, LoggerMiddleware } from "./middleware"
import { FenceMiddleware } from "./fence"
import { initProjectors } from "./projectors"
import { InstanceRoutes } from "./routes/instance"
import { ControlPlaneRoutes } from "./routes/control"
import { UIRoutes } from "./routes/ui"
import { GlobalRoutes } from "./routes/global"
import { WorkspaceRouterMiddleware } from "./workspace"
import { InstanceMiddleware } from "./routes/instance/middleware"
import { WorkspaceRoutes } from "./routes/control/workspace"
import { ExperimentalHttpApiServer } from "./routes/instance/httpapi/server"
import { WorkspacePaths } from "./routes/instance/httpapi/workspace"
import { Context } from "effect"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

initProjectors()

const log = Log.create({ service: "server" })

export type Listener = {
  hostname: string
  port: number
  url: URL
  stop: (close?: boolean) => Promise<void>
}

export const Default = lazy(() => create({}))

function create(opts: { cors?: string[] }) {
  const app = new Hono()
    .onError(ErrorMiddleware)
    .use(AuthMiddleware)
    .use(LoggerMiddleware)
    .use(CompressionMiddleware)
    .use(CorsMiddleware(opts))
    .route("/global", GlobalRoutes())

  const runtime = adapter.create(app)

  if (Flag.OPENCODE_WORKSPACE_ID) {
    return {
      app: app
        .use(InstanceMiddleware(Flag.OPENCODE_WORKSPACE_ID ? WorkspaceID.make(Flag.OPENCODE_WORKSPACE_ID) : undefined))
        .use(FenceMiddleware)
        .route("/", InstanceRoutes(runtime.upgradeWebSocket)),
      runtime,
    }
  }

  const workspaceApp = new Hono()
  const workspaceLegacyApp = new Hono()
    .use(InstanceMiddleware())
    .route("/experimental/workspace", WorkspaceRoutes())
    .use(WorkspaceRouterMiddleware(runtime.upgradeWebSocket))
  if (Flag.OPENCODE_EXPERIMENTAL_HTTPAPI) {
    const handler = ExperimentalHttpApiServer.webHandler().handler
    const context = Context.empty() as Context.Context<unknown>
    workspaceApp.get(WorkspacePaths.adaptors, (c) => handler(c.req.raw, context))
    workspaceApp.get(WorkspacePaths.list, (c) => handler(c.req.raw, context))
    workspaceApp.post(WorkspacePaths.list, (c) => handler(c.req.raw, context))
    workspaceApp.get(WorkspacePaths.status, (c) => handler(c.req.raw, context))
    workspaceApp.delete(WorkspacePaths.remove, (c) => handler(c.req.raw, context))
    workspaceApp.post(WorkspacePaths.sessionRestore, (c) => handler(c.req.raw, context))
  }
  workspaceApp.route("/", workspaceLegacyApp)

  return {
    app: app
      .route("/", ControlPlaneRoutes())
      .route("/", workspaceApp)
      .route("/", InstanceRoutes(runtime.upgradeWebSocket))
      .route("/", UIRoutes()),
    runtime,
  }
}

export async function openapi() {
  // Build a fresh app with all routes registered directly so
  // hono-openapi can see describeRoute metadata (`.route()` wraps
  // handlers when the sub-app has a custom errorHandler, which
  // strips the metadata symbol).
  const { app } = create({})
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
  const built = create(opts)
  const server = await built.runtime.listen(opts)

  const next = new URL("http://localhost")
  next.hostname = opts.hostname
  next.port = String(server.port)
  url = next

  const mdns =
    opts.mdns &&
    server.port &&
    opts.hostname !== "127.0.0.1" &&
    opts.hostname !== "localhost" &&
    opts.hostname !== "::1"
  if (mdns) {
    MDNS.publish(server.port, opts.mdnsDomain)
  } else if (opts.mdns) {
    log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
  }

  let closing: Promise<void> | undefined
  return {
    hostname: opts.hostname,
    port: server.port,
    url: next,
    stop(close?: boolean) {
      closing ??= (async () => {
        if (mdns) MDNS.unpublish()
        await server.stop(close)
      })()
      return closing
    },
  }
}

export * as Server from "./server"
