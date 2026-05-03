import { generateSpecs } from "hono-openapi"
import { Hono } from "hono"
import { adapter } from "#hono"
import { lazy } from "@/util/lazy"
import * as Log from "@opencode-ai/core/util/log"
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
import * as ServerBackend from "./backend"
import type { CorsOptions } from "./cors"
import { rewriteRequestBasePath } from "./base-path"

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

type ServerApp = {
  fetch(request: Request): Response | Promise<Response>
  request(input: string | URL | Request, init?: RequestInit): Response | Promise<Response>
}

type ListenOptions = CorsOptions & {
  port: number
  hostname: string
  basePath?: string
  mdns?: boolean
  mdnsDomain?: string
}

type ServerOptions = CorsOptions & {
  basePath?: string
}

const DefaultHono = lazy(() =>
  withBackend({ backend: "hono", reason: "stable" }, createHono({}, { backend: "hono", reason: "stable" })),
)
const DefaultHttpApi = lazy(() => createDefaultHttpApi())

function select() {
  return ServerBackend.select()
}

export const backend = select

export const Default = (opts: ServerOptions = {}) => {
  if (!opts.basePath && !opts.cors?.length) {
    const selected = select()
    return selected.backend === "effect-httpapi" ? DefaultHttpApi() : DefaultHono()
  }

  const selected = select()
  return selected.backend === "effect-httpapi"
    ? withBackend(selected, createHttpApi(opts))
    : withBackend(selected, createHono(opts, selected))
}

function create(opts: ListenOptions) {
  const selected = select()
  return selected.backend === "effect-httpapi"
    ? withBackend(selected, createHttpApi(opts))
    : withBackend(selected, createHono(opts, selected))
}

export function Legacy(opts: ServerOptions = {}) {
  return withBackend({ backend: "hono", reason: "explicit" }, createHono(opts, { backend: "hono", reason: "explicit" }))
}

function createDefaultHttpApi() {
  return withBackend(select(), createHttpApi())
}

function withBackend<T extends { app: ServerApp; runtime: unknown }>(selection: ServerBackend.Selection, built: T) {
  log.info("server backend selected", ServerBackend.attributes(selection))
  return built
}

function toRequest(input: string | URL | Request, init?: RequestInit) {
  return input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init)
}

function withBasePathHono(app: Hono, basePath: string | undefined) {
  if (!basePath) return app

  const fetch = app.fetch.bind(app)
  app.fetch = ((request, env, executionCtx) =>
    fetch(rewriteRequestBasePath(request, basePath), env, executionCtx)) as typeof app.fetch
  app.request = ((input, init) => fetch(rewriteRequestBasePath(toRequest(input, init), basePath))) as typeof app.request
  return app
}

function createHttpApi(opts: ServerOptions = {}) {
  const handler = ExperimentalHttpApiServer.webHandler(opts).handler
  const app: ServerApp = {
    fetch: (request: Request) => handler(rewriteRequestBasePath(request, opts.basePath ?? ""), ExperimentalHttpApiServer.context),
    request(input, init) {
      return app.fetch(rewriteRequestBasePath(toRequest(input, init), opts.basePath ?? ""))
    },
  }
  return {
    app,
    runtime: adapter.createFetch(app),
  }
}

function createHono(opts: ServerOptions, selection: ServerBackend.Selection = ServerBackend.force(select(), "hono")) {
  const backendAttributes = ServerBackend.attributes(selection)
  const app = withBasePathHono(
    new Hono()
    .onError(ErrorMiddleware)
    .use(AuthMiddleware)
    .use(LoggerMiddleware(backendAttributes))
    .use(CompressionMiddleware)
    .use(CorsMiddleware(opts))
    .route("/global", GlobalRoutes()),
    opts.basePath,
  )

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
  workspaceApp.route("/", workspaceLegacyApp)

  return {
      app: app
        .route("/", ControlPlaneRoutes())
        .route("/", workspaceApp)
        .route("/", InstanceRoutes(runtime.upgradeWebSocket))
        .route("/", UIRoutes(opts.basePath ?? "")),
      runtime,
    }
}

export async function openapi() {
  // Build a fresh app with all routes registered directly so
  // hono-openapi can see describeRoute metadata (`.route()` wraps
  // handlers when the sub-app has a custom errorHandler, which
  // strips the metadata symbol).
  const { app } = createHono({})
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

export async function listen(opts: ListenOptions): Promise<Listener> {
  const built = create(opts)
  const server = await built.runtime.listen(opts)

  const next = new URL("http://localhost")
  next.hostname = opts.hostname
  next.port = String(server.port)
  next.pathname = opts.basePath ? `${opts.basePath}/` : "/"
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
