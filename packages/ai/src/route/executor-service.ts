import { Context, Effect, Stream } from "effect"
import type { Headers, HttpClientRequest, HttpClientResponse } from "effect/http"
import { HttpContext, type AIError } from "../schema/errors.js"
import type { ClientTls } from "../schema/options.js"

// The service tag lives in its own leaf module so `Media.Asset` (imported by the schema layer) can require the
// executor without pulling the full executor implementation, and therefore the schema barrel, into a cycle.
export interface Interface {
  readonly execute: (
    request: HttpClientRequest.HttpClientRequest,
    middleware?: HttpMiddleware,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse, AIError>
}

export type HttpHandler = (
  request: HttpClientRequest.HttpClientRequest,
) => Effect.Effect<HttpClientResponse.HttpClientResponse, Error>
export type HttpMiddleware = (
  request: HttpClientRequest.HttpClientRequest,
  handler: HttpHandler,
) => Effect.Effect<HttpClientResponse.HttpClientResponse, Error>

export class RequestExecutorService extends Context.Service<RequestExecutorService, Interface>()(
  "@opencode/AI/RequestExecutor",
) {}
export const Service = RequestExecutorService

/**
 * The client certificate for the HTTP request being executed. Transports set it from `http.tls`; the executor's HTTP
 * client presents it, since only the runtime's fetch can.
 */
export const CurrentTls = Context.Reference<ClientTls | undefined>("@opencode/AI/RequestExecutor/CurrentTls", {
  defaultValue: () => undefined,
})
export type Service = RequestExecutorService

/**
 * Middleware for every provider request made while it is set: model calls, media submits, polls, results and cancels,
 * whatever the modality. Set it with {@link withMiddleware}. Downloads of a `url` asset don't use it; they use the
 * asset's own `middleware`, which a route sets only for URLs on the provider's origin.
 */
export const CurrentMiddleware = Context.Reference<HttpMiddleware | undefined>(
  "@opencode/AI/RequestExecutor/CurrentMiddleware",
  { defaultValue: () => undefined },
)

/** `outer` wraps `inner`: it sees the request first and the response last. */
export const composeMiddleware = (
  outer: HttpMiddleware | undefined,
  inner: HttpMiddleware | undefined,
): HttpMiddleware | undefined => {
  if (outer === undefined) return inner
  if (inner === undefined) return outer
  return (request, handler) => outer(request, (forwarded) => inner(forwarded, handler))
}

/**
 * Runs `fn` on every provider request `self` makes, an Effect or a Stream. Inside an outer `withMiddleware`, the outer
 * one wraps this one. Executor-wide middleware (`RequestExecutor.middleware`) wraps both.
 */
export const withMiddleware =
  (fn: HttpMiddleware) =>
  <Self extends Effect.Effect<unknown, unknown, unknown> | Stream.Stream<unknown, unknown, unknown>>(
    self: Self,
  ): Self => {
    const merged = Effect.gen(function* () {
      return composeMiddleware(yield* CurrentMiddleware, fn)
    })
    // One signature for both, so it infers inside `pipe`; each branch returns the same kind it was given.
    return (
      Stream.isStream(self)
        ? Stream.provideServiceEffect(self, CurrentMiddleware, merged)
        : Effect.provideServiceEffect(self, CurrentMiddleware, merged)
    ) as Self
  }

export const headerDetails = (headers: Headers.Headers) =>
  Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, value]))

export const responseHttp = (response: HttpClientResponse.HttpClientResponse) =>
  new HttpContext({
    url: response.request.url,
    status: response.status,
    headers: headerDetails(response.headers),
  })
