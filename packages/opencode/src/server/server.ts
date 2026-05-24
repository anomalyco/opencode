import "./init-projectors"

import { handleCollabRequest } from "@/collab/router"
import { parsePreviewPath, handlePreviewHttp, attachPreviewUpgrade } from "@/collab/preview-router"
import { cookieAuthorizesRequest } from "@/collab/cookie-auth"
import { Database } from "@/storage/db"
import { NodeHttpServer } from "@effect/platform-node"
import * as Log from "@opencode-ai/core/util/log"
import { ConfigProvider, Context, Effect, Exit, Layer, Scope, Stream } from "effect"
import { HttpMiddleware, HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { OpenApi } from "effect/unstable/httpapi"
import { createServer } from "node:http"
import { MDNS } from "./mdns"
import { HttpApiApp } from "./routes/instance/httpapi/server"
import { disposeMiddleware } from "./routes/instance/httpapi/lifecycle"
import { WebSocketTracker } from "./routes/instance/httpapi/websocket-tracker"
import { PublicApi } from "./routes/instance/httpapi/public"
import type { CorsOptions } from "./cors"
import { lazy } from "@/util/lazy"

// Module load time — used as a coarse server-start time for /healthz uptime.
// Close enough for an ALB health probe; not used for SLA reporting.
const serverStartedAt = Date.now()

// ── Collab middleware ──────────────────────────────────────────────────────────
// Intercepts /collab/* requests before the Effect HTTP router's catch-all UI
// route can serve index.html for them. Bridges the standard Web Request/Response
// API used by the collab router into Effect's HttpServerRequest/HttpServerResponse.

const collabMiddleware: HttpMiddleware.HttpMiddleware = (app) =>
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest
    const pathname = new URL(req.url, "http://localhost").pathname

    // /healthz — ALB / ECS health probe.  Sits ahead of every other route so
    // a degraded collab/preview path can't fail the liveness check on its own.
    // Returns 503 when the SQLite handle is unreachable; the ALB pulls the
    // task out of rotation and ECS replaces it.
    if (pathname === "/healthz") {
      return yield* serveHealthz()
    }

    // /preview/<port>/<rest> — HTTP reverse proxy to a dev server running
    // inside this container.  WebSocket upgrades for the same path are
    // handled separately by attachPreviewUpgrade on the http.Server.
    const previewParsed = parsePreviewPath(pathname)
    if (previewParsed) {
      const webRequest = yield* HttpServerRequest.toWeb(req)
      // Gate the preview proxy on a valid collab cookie.  Without this,
      // any internet client can hit /preview/<port>/ and reach a dev
      // server inside the container — that's the ADR-0001 hole PR #2
      // didn't close.  Cookie alone is enough (no port↔session binding
      // for v1 — see preview-router.ts:17-22 on the shell-trust model).
      if (cookieAuthorizesRequest(webRequest) !== "allow") {
        return HttpServerResponse.raw(new TextEncoder().encode("Forbidden"), {
          status: 403,
          headers: new Headers({ "content-type": "text/plain" }),
        })
      }
      const webResponse = yield* Effect.promise(() =>
        handlePreviewHttp(webRequest, previewParsed.port, previewParsed.rest),
      )
      const previewHeaders = new Headers(webResponse.headers)
      // The upstream body is a stream — let Effect pipe it through without
      // buffering, so video / large downloads / SSE all work.
      if (webResponse.body) {
        const previewStream = Stream.fromAsyncIterable(
          webResponse.body as AsyncIterable<Uint8Array>,
          () => new Error("Preview stream error"),
        )
        return HttpServerResponse.stream(previewStream, {
          status: webResponse.status,
          headers: previewHeaders,
        })
      }
      return HttpServerResponse.raw(new Uint8Array(), {
        status: webResponse.status,
        headers: previewHeaders,
      })
    }

    // Only intercept collab API/auth/invite paths — let UI routes fall through to index.html
    const isCollabApi =
      pathname === "/collab/auth/github" ||
      pathname.startsWith("/collab/auth/") ||
      pathname.startsWith("/collab/invite/") ||
      pathname === "/collab/repos" ||
      pathname === "/collab/me" ||
      pathname === "/collab/session" ||
      pathname.startsWith("/collab/session/")
    if (!isCollabApi) return yield* app

    // toWeb converts Effect's HttpServerRequest → standard Web API Request (body included)
    const webRequest = yield* HttpServerRequest.toWeb(req)
    const webResponse = yield* Effect.promise(() => handleCollabRequest(webRequest))

    const resHeaders = new Headers(webResponse.headers)

    // SSE: stream without buffering
    if (webResponse.headers.get("content-type")?.startsWith("text/event-stream") && webResponse.body) {
      const rs = webResponse.body
      const effectStream = Stream.fromAsyncIterable(
        rs as AsyncIterable<Uint8Array>,
        () => new Error("SSE stream error"),
      )
      return HttpServerResponse.stream(effectStream, { status: webResponse.status, headers: resHeaders })
    }

    const buf = yield* Effect.promise(() => webResponse.arrayBuffer())
    return HttpServerResponse.raw(new Uint8Array(buf), { status: webResponse.status, headers: resHeaders })
  })

const serveHealthz = () =>
  Effect.sync(() => {
    const dbOk = pingDatabase()
    const githubStatus = cachedGitHubStatus()
    // db is the only check that can flip overall ok; github + native_api are
    // informational so a degraded external dep doesn't pull the ALB out from
    // under us (we'd be DoS-ing ourselves if GitHub's HEAD ever 5xx'd).
    const body = {
      ok: dbOk,
      checks: {
        db: dbOk ? "ok" : "fail",
        github: githubStatus,
        // native_api is the server itself; if Bun is up enough to answer /healthz
        // then the native API is up too — we just record it for the dashboard.
        native_api: "ok",
      },
      version: process.env["OPENCODE_VERSION"] ?? "unknown",
      uptime_s: Math.floor((Date.now() - serverStartedAt) / 1000),
    }
    return HttpServerResponse.jsonUnsafe(body, {
      status: dbOk ? 200 : 503,
      headers: { "cache-control": "no-store" },
    })
  })

function pingDatabase(): boolean {
  try {
    Database.use((db) => db.run("SELECT 1"))
    return true
  } catch (err) {
    log.error("/healthz db ping failed", { error: err instanceof Error ? err.message : String(err) })
    return false
  }
}

// GitHub status — cached for 5 minutes so /healthz doesn't HEAD api.github.com
// on every probe (ECS hits this every 15 s).  Async probe runs lazily; the
// healthz call returns whatever the last sample said.  A first-call result of
// "unknown" is acceptable for a brand-new task — by the time the ALB has
// looked twice it's settled.
let githubProbe: { ts: number; status: "ok" | "degraded" | "unknown" } = { ts: 0, status: "unknown" }
const GITHUB_PROBE_TTL_MS = 5 * 60 * 1000

function cachedGitHubStatus(): "ok" | "degraded" | "unknown" {
  const now = Date.now()
  if (now - githubProbe.ts > GITHUB_PROBE_TTL_MS) {
    // Fire-and-forget; the next /healthz picks up the result.
    void refreshGitHubProbe().catch(() => {
      githubProbe = { ts: now, status: "degraded" }
    })
  }
  return githubProbe.status
}

async function refreshGitHubProbe(): Promise<void> {
  try {
    const res = await fetch("https://api.github.com/", { method: "HEAD", signal: AbortSignal.timeout(3000) })
    githubProbe = { ts: Date.now(), status: res.ok ? "ok" : "degraded" }
  } catch {
    githubProbe = { ts: Date.now(), status: "degraded" }
  }
}

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

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
type ListenerState = {
  scope: Scope.Scope
  server: Context.Service.Shape<typeof HttpServer.HttpServer>
  http: ListenerServer
  websockets: WebSocketTracker.Interface
}
type EffectListener = Omit<Listener, "stop"> & {
  stop: (close?: boolean) => Effect.Effect<void>
}

interface ListenerServer {
  readonly closeAll: Effect.Effect<void>
}

class ListenerServerService extends Context.Service<ListenerServerService, ListenerServer>()(
  "@opencode/ListenerServer",
) {}

export const Default = lazy(() => {
  const handler = HttpApiApp.webHandler().handler
  const app: ServerApp = {
    fetch: (request: Request) => {
      const url = new URL(request.url)
      if (url.pathname.startsWith("/collab/")) {
        return handleCollabRequest(request)
      }
      return handler(request, HttpApiApp.context)
    },
    request(input, init) {
      return app.fetch(input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init))
    },
  }
  return { app }
})

export async function openapi() {
  return OpenApi.fromApi(PublicApi)
}

export let url: URL

export async function listen(opts: ListenOptions): Promise<Listener> {
  const listener = await Effect.runPromise(listenEffect(opts))
  return {
    hostname: listener.hostname,
    port: listener.port,
    url: listener.url,
    stop: (close?: boolean) => Effect.runPromiseExit(listener.stop(close)).then(() => undefined),
  }
}

const listenEffect: (opts: ListenOptions) => Effect.Effect<EffectListener, unknown> = Effect.fn("Server.listen")(
  function* (opts: ListenOptions) {
    const state = yield* startWithPortFallback(opts)
    const address = yield* tcpAddress(state)
    const listenerUrl = makeURL(opts.hostname, address.port)
    url = listenerUrl

    const unpublishMdns = yield* setupMdns(opts, address.port, state.scope)

    return {
      hostname: opts.hostname,
      port: address.port,
      url: listenerUrl,
      stop: yield* makeStop(state, unpublishMdns),
    }
  },
)

function listenerLayer(opts: ListenOptions, port: number) {
  return HttpRouter.serve(HttpApiApp.createRoutes(opts), {
    // collabMiddleware intercepts /collab/* before the catch-all uiRoute serves index.html
    middleware: (app) => disposeMiddleware(collabMiddleware(app)),
    disableLogger: true,
    disableListenLog: true,
  }).pipe(
    Layer.provideMerge(WebSocketTracker.layer),
    Layer.provideMerge(serverLayer({ port, hostname: opts.hostname })),
    // Install a fresh `ConfigProvider` per listener so `Config.string(...)`
    // reads reflect the current `process.env`. Effect's default
    // `ConfigProvider` snapshots `process.env` on first read and caches the
    // result on a module-singleton Reference; without overriding it here,
    // every later `Server.listen()` keeps observing that initial snapshot.
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv())),
  )
}

function startWithPortFallback(opts: ListenOptions) {
  if (opts.port !== 0) return startListener(opts, opts.port)
  // Match the legacy listener port-resolution behavior: explicit `0` prefers
  // 4096 first, then any free port.
  return startListener(opts, 4096).pipe(Effect.catch(() => startListener(opts, 0)))
}

function startListener(opts: ListenOptions, port: number) {
  const scope = Scope.makeUnsafe()
  return Layer.buildWithMemoMap(listenerLayer(opts, port), Layer.makeMemoMapUnsafe(), scope).pipe(
    Effect.provide(HttpApiApp.context),
    Effect.onError(() => Scope.close(scope, Exit.void).pipe(Effect.ignore)),
    Effect.map(
      (ctx): ListenerState => ({
        scope,
        server: Context.get(ctx, HttpServer.HttpServer),
        http: Context.get(ctx, ListenerServerService),
        websockets: Context.get(ctx, WebSocketTracker.Service),
      }),
    ),
  )
}

function tcpAddress(state: ListenerState) {
  return Effect.gen(function* () {
    if (state.server.address._tag === "TcpAddress") return state.server.address
    yield* Scope.close(state.scope, Exit.void).pipe(Effect.ignore)
    return yield* Effect.die(new Error(`Unexpected HttpServer address tag: ${state.server.address._tag}`))
  })
}

function makeURL(hostname: string, port: number) {
  const result = new URL("http://localhost")
  result.hostname = hostname
  result.port = String(port)
  return result
}

function setupMdns(opts: ListenOptions, port: number, scope: Scope.Scope) {
  return Effect.gen(function* () {
    const publish =
      opts.mdns && port && opts.hostname !== "127.0.0.1" && opts.hostname !== "localhost" && opts.hostname !== "::1"
    if (publish) {
      const unpublish = yield* Effect.cached(Effect.sync(() => MDNS.unpublish()))
      yield* Effect.sync(() => MDNS.publish(port, opts.mdnsDomain))
      yield* Scope.addFinalizer(scope, unpublish)
      return unpublish
    }
    if (opts.mdns) log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
    return Effect.void
  })
}

function makeStop(state: ListenerState, unpublishMdns: Effect.Effect<void>) {
  return Effect.gen(function* () {
    const forceCloseOnce = yield* Effect.cached(forceClose(state).pipe(Effect.ignore))
    const closeScopeOnce = yield* Effect.cached(Scope.close(state.scope, Exit.void).pipe(Effect.ignore))

    return (close?: boolean) =>
      Effect.gen(function* () {
        yield* unpublishMdns
        if (close) yield* forceCloseOnce
        yield* closeScopeOnce
      })
  })
}

function forceClose(state: ListenerState) {
  return Effect.all([state.http.closeAll, state.websockets.closeAll], { concurrency: "unbounded", discard: true })
}

function serverLayer(opts: { port: number; hostname: string }) {
  const server = createServer()
  const serverRef = { closeStarted: false, forceStop: false }
  const close = server.close.bind(server)
  // Keep shutdown owned by NodeHttpServer, but honor listener.stop(true) by
  // force-closing active HTTP sockets when its finalizer calls server.close().
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Node's overloads don't preserve a monkey-patched method assignment.
  server.close = ((callback?: Parameters<typeof server.close>[0]) => {
    serverRef.closeStarted = true
    const result = close(callback)
    if (serverRef.forceStop) server.closeAllConnections()
    return result
  }) as typeof server.close

  // /preview/<port>/* WebSocket upgrades — must hook into the raw Node
  // server's `upgrade` event, ahead of any other ws handlers, because by
  // the time Effect's HTTP layer sees a request the upgrade chance is
  // gone.  Non-/preview upgrades fall through to opencode's own ws routes.
  attachPreviewUpgrade(server)

  return Layer.mergeAll(
    NodeHttpServer.layer(() => server, { port: opts.port, host: opts.hostname, gracefulShutdownTimeout: "1 second" }),
    Layer.succeed(ListenerServerService)(
      ListenerServerService.of({
        closeAll: Effect.sync(() => {
          serverRef.forceStop = true
          if (serverRef.closeStarted) server.closeAllConnections()
        }),
      }),
    ),
  )
}

export * as Server from "./server"
