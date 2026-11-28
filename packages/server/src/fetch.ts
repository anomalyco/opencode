export * as ServerFetch from "./fetch"

import { Context, Effect, flow, Layer } from "effect"
import { HttpEffect, HttpMiddleware, HttpRouter, HttpServer } from "effect/http"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { isAllowedCorsOrigin } from "./cors"
import { RequestSite } from "./request-site"
import { withoutParentSpan } from "./request-tracing"
import { createRoutes } from "./routes"
import type { ServerOptions } from "./options"

export interface BootOptions {
  /**
   * Runtime-profile service replacements, applied after the standard set so later entries
   * win — swaps services the standard graph assumes are local. See `ServerWorkerd.replacements`.
   */
  readonly overrides?: LayerNode.Replacements
}

/** Internal entry for runtime profiles (such as `ServerWorkerd.create`) that also need the built service context. */
export const makeWithContext = Effect.fn("ServerFetch.makeWithContext")(function* (
  options: ServerOptions = {},
  boot: BootOptions = {},
) {
  const context = yield* build(createRoutes(options, () => [], boot.overrides ?? []))
  const handler = yield* serve(
    context,
    flow(
      RequestSite.middleware(options),
      HttpMiddleware.cors({ allowedOrigins: (origin) => isAllowedCorsOrigin(origin, options), maxAge: 86_400 }),
    ),
  )
  return { handler, context }
})

/**
 * Builds a route layer (`createRoutes` or `createEmbeddedRoutes`) in the current Scope. Shared with the SDK's
 * embedded host so both serve the same graph.
 */
export const build = <A, E, R>(routes: Layer.Layer<A, E, R>) =>
  // Handlers capture the build context; without the caller's span, each request is its own trace.
  Layer.build(routes.pipe(Layer.provide(HttpServer.layerServices))).pipe(withoutParentSpan)

/**
 * Starts serving a built route context: resumes suspended Sessions in a fiber the current Scope owns, then returns
 * the web handler. Shared with the SDK's embedded host, which registers its plugins between `build` and `serve` so
 * recovery never runs without them.
 */
export const serve = Effect.fnUntraced(function* (
  context: Context.Context<HttpRouter.HttpRouter | SessionRestart.Service>,
  middleware: (
    app: ReturnType<HttpRouter.HttpRouter["asHttpEffect"]>,
  ) => ReturnType<HttpRouter.HttpRouter["asHttpEffect"]> = (app) => app,
) {
  // Forked so the returned handler is never delayed; resumed drains are already logged and durably recorded by the
  // execution layer. The sweep runs in the built context, outside the caller's trace.
  yield* Context.get(context, SessionRestart.Service).resumeSuspendedSessions.pipe(
    Effect.provideContext(context),
    withoutParentSpan,
    Effect.forkScoped,
  )
  return Context.get(context, HttpRouter.HttpRouter)
    .asHttpEffect()
    .pipe(middleware, HttpEffect.toWebHandlerWith(context))
})

/**
 * Builds a web-standard fetch handler — `(request: Request) => Promise<Response>` — serving the
 * same HttpApi routes as the Node server process without binding a port, owning a listener, or
 * installing signal handlers. This is the entry for runtimes that hand requests to the embedder
 * instead of letting it listen: workerd (Workers and Durable Objects), Deno.serve, Bun.serve, or
 * a test harness.
 *
 * The application layer builds EAGERLY, inside the caller's `Scope`, before the handler is
 * returned. Do not convert this to a lazy first-request build: on workerd, a first request that
 * aborts mid-build interrupts the layer construction and wedges every subsequent request
 * (Effect-TS/effect#6319 class). The embedder owns the lifecycle — closing the scope releases
 * the application layer.
 *
 * Auth follows `createRoutes` semantics: `options.password` enforces Basic auth; omitting it
 * serves unauthenticated, so an embedder without a password must front the handler with its own
 * access control.
 *
 * Sessions whose execution claim was never released resume once the layer is built, exactly as
 * the Node server process does: a runtime that dies without teardown — an evicted Durable
 * Object leaves the same durable signature as a killed process — replays orphaned turns on the
 * next boot, and the sweep is a no-op when nothing is suspended.
 */
export const make = Effect.fn("ServerFetch.make")(function* (options: ServerOptions = {}, boot: BootOptions = {}) {
  return (yield* makeWithContext(options, boot)).handler
})
