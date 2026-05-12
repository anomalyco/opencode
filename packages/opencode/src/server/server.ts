import * as Log from "@opencode-ai/core/util/log"
import { ConfigProvider, Context, Effect, Exit, Layer, Scope } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { OpenApi } from "effect/unstable/httpapi"
import * as HttpApiServer from "#httpapi-server"
import { MDNS } from "./mdns"
import { initProjectors } from "./projectors"
import { ExperimentalHttpApiServer } from "./routes/instance/httpapi/server"
import { disposeMiddleware } from "./routes/instance/httpapi/lifecycle"
import { WebSocketTracker } from "./routes/instance/httpapi/websocket-tracker"
import { PublicApi } from "./routes/instance/httpapi/public"
import type { CorsOptions } from "./cors"

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
  mdns?: boolean
  mdnsDomain?: string
}

const defaultHttpApi = (() => {
  const handler = ExperimentalHttpApiServer.webHandler().handler
  const app: ServerApp = {
    fetch: (request: Request) => handler(request, ExperimentalHttpApiServer.context),
    request(input, init) {
      return app.fetch(input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init))
    },
  }
  return { app }
})()

export const Default = () => defaultHttpApi

export async function openapi() {
  return OpenApi.fromApi(PublicApi)
}

export let url: URL

export async function listen(opts: ListenOptions): Promise<Listener> {
  log.info("server backend", { "opencode.server.runtime": HttpApiServer.name })

  const buildLayer = (port: number) =>
    HttpRouter.serve(ExperimentalHttpApiServer.createRoutes(opts), {
      middleware: disposeMiddleware,
      disableLogger: true,
      disableListenLog: true,
    }).pipe(
      Layer.provideMerge(WebSocketTracker.layer),
      Layer.provideMerge(HttpApiServer.layer({ port, hostname: opts.hostname })),
      // Install a fresh `ConfigProvider` per listener so `Config.string(...)`
      // reads reflect the current `process.env`. Effect's default
      // `ConfigProvider` snapshots `process.env` on first read and caches the
      // result on a module-singleton Reference; without overriding it here,
      // every later `Server.listen()` keeps observing that initial snapshot.
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv())),
    )

  const start = async (port: number) => {
    const scope = Scope.makeUnsafe()
    try {
      const layer = buildLayer(port) as Layer.Layer<
        HttpServer.HttpServer | WebSocketTracker.Service | HttpApiServer.Service,
        unknown,
        never
      >
      const ctx = await Effect.runPromise(Layer.buildWithMemoMap(layer, Layer.makeMemoMapUnsafe(), scope))
      return { scope, ctx }
    } catch (err) {
      await Effect.runPromise(Scope.close(scope, Exit.void)).catch(() => undefined)
      throw err
    }
  }

  // Match the legacy adapter port-resolution behavior: explicit `0` prefers
  // 4096 first, then any free port.
  let resolved: Awaited<ReturnType<typeof start>> | undefined
  if (opts.port === 0) {
    resolved = await start(4096).catch(() => undefined)
    if (!resolved) resolved = await start(0)
  } else {
    resolved = await start(opts.port)
  }
  if (!resolved) throw new Error(`Failed to start server on port ${opts.port}`)

  const server = Context.get(resolved.ctx, HttpServer.HttpServer)
  if (server.address._tag !== "TcpAddress") {
    await Effect.runPromise(Scope.close(resolved.scope, Exit.void))
    throw new Error(`Unexpected HttpServer address tag: ${server.address._tag}`)
  }
  const port = server.address.port

  const innerUrl = new URL("http://localhost")
  innerUrl.hostname = opts.hostname
  innerUrl.port = String(port)
  url = innerUrl

  const mdns =
    opts.mdns && port && opts.hostname !== "127.0.0.1" && opts.hostname !== "localhost" && opts.hostname !== "::1"
  if (mdns) {
    MDNS.publish(port, opts.mdnsDomain)
  } else if (opts.mdns) {
    log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
  }

  let forceStopPromise: Promise<void> | undefined
  let stopPromise: Promise<void> | undefined
  let mdnsUnpublished = false
  const unpublish = () => {
    if (!mdns || mdnsUnpublished) return
    mdnsUnpublished = true
    MDNS.unpublish()
  }
  const forceStop = () => {
    forceStopPromise ??= Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* Context.get(resolved!.ctx, HttpApiServer.Service).closeAll
        yield* Context.get(resolved!.ctx, WebSocketTracker.Service).closeAll
      }),
    ).then(() => undefined)
    return forceStopPromise
  }

  return {
    hostname: opts.hostname,
    port,
    url: innerUrl,
    stop: (close?: boolean) => {
      unpublish()
      const requested = close ? forceStop() : Promise.resolve()
      stopPromise ??= requested
        .then(() => Effect.runPromiseExit(Scope.close(resolved!.scope, Exit.void)))
        .then(() => undefined)
      return requested.then(() => stopPromise!)
    },
  }
}

export * as Server from "./server"
