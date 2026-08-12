export * as ServerFetch from "./fetch"

import { Context, Effect, Layer } from "effect"
import { HttpEffect, HttpMiddleware, HttpRouter, HttpServer } from "effect/unstable/http"
import { SessionRestart } from "@opencode-ai/core/session/execution/restart"
import { isAllowedCorsOrigin } from "./cors"
import { createRoutes } from "./routes"
import type { ServerOptions } from "./options"

export interface BootOptions {
  /**
   * Resumes execution-journaled Sessions once the application layer boots. Pair with
   * `SessionExecution.configured({ suspendOnStart: true })` on runtimes that can die without
   * teardown, so turns orphaned by a hard death replay on the next boot.
   */
  readonly resumeSuspendedSessions?: boolean
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
 */
export const make = Effect.fn("ServerFetch.make")(function* (options: ServerOptions = {}, boot: BootOptions = {}) {
  const context = yield* Layer.build(createRoutes(options, () => []).pipe(Layer.provide(HttpServer.layerServices)))
  // Forked so the returned handler is never delayed; resumed drains are already
  // logged and durably recorded by the execution layer.
  if (boot.resumeSuspendedSessions)
    yield* Effect.forkDetach(Context.get(context, SessionRestart.Service).resumeSuspendedSessions)
  return Context.get(context, HttpRouter.HttpRouter)
    .asHttpEffect()
    .pipe(
      HttpMiddleware.cors({ allowedOrigins: isAllowedCorsOrigin, maxAge: 86_400 }),
      HttpEffect.toWebHandlerWith(context),
    )
})
