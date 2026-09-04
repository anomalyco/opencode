export * as ServerFetch from "./fetch"

import { Context, Effect, Layer } from "effect"
import { HttpEffect, HttpMiddleware, HttpRouter, HttpServer } from "effect/unstable/http"
import { SessionRestart } from "@opencode-ai/core/session/execution/restart"
import type { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { isAllowedCorsOrigin } from "./cors"
import { createRoutes } from "./routes"
import type { ServerOptions } from "./options"

export interface BootOptions {
  /**
   * Runtime-profile service replacements, applied after the standard set so later entries
   * win — swaps services the standard graph assumes are local. See `ServerWorkerd.replacements`.
   */
  readonly overrides?: LayerNode.Replacements
}

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
  const context = yield* Layer.build(
    createRoutes(options, () => [], boot.overrides ?? []).pipe(Layer.provide(HttpServer.layerServices)),
  )
  // Forked so the returned handler is never delayed; resumed drains are already
  // logged and durably recorded by the execution layer.
  yield* Effect.forkDetach(Context.get(context, SessionRestart.Service).resumeSuspendedSessions)
  return Context.get(context, HttpRouter.HttpRouter)
    .asHttpEffect()
    .pipe(
      HttpMiddleware.cors({ allowedOrigins: (origin) => isAllowedCorsOrigin(origin, options), maxAge: 86_400 }),
      HttpEffect.toWebHandlerWith(context),
    )
})
