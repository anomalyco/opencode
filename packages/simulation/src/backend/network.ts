import { Clock, Effect, Layer, Ref } from "effect"
import { HttpClient, HttpClientResponse, type HttpMethod } from "effect/unstable/http"
import { HttpClientError, TransportError } from "effect/unstable/http/HttpClientError"
import type { HttpClientRequest } from "effect/unstable/http"
import { SimulationProtocol } from "../protocol"

/**
 * Simulated network.
 *
 * Replaces the `HttpClient.HttpClient` platform node in simulation mode. All
 * outbound HTTP resolves against an in-memory route table; unknown
 * destinations fail loudly with a transport error so no simulation run can
 * silently reach the real network. The scripted LLM is one registered route,
 * not a separate mechanism.
 *
 * Each acquired run owns its routes and request log.
 */

export interface Route {
  /** Return a response effect to claim the request, undefined to pass. */
  readonly match: (
    request: HttpClientRequest.HttpClientRequest,
    url: URL,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError> | undefined
}

export type LogEntry = SimulationProtocol.Backend.NetworkLogEntry

const LOG_LIMIT = 1000

/** Static JSON route: exact method + origin/path match answered with a fixed body. */
export function json(method: HttpMethod.HttpMethod, url: string, body: unknown): Route {
  return {
    match: (request, requestUrl) => {
      if (request.method !== method) return undefined
      if (requestUrl.origin + requestUrl.pathname !== url) return undefined
      return Effect.sync(() =>
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
        ),
      )
    },
  }
}

export interface Run {
  readonly client: HttpClient.HttpClient
  readonly log: () => Effect.Effect<readonly LogEntry[]>
}

export const make = Effect.fn("SimulationNetwork.make")(function* (routes: readonly Route[] = []) {
  const log = yield* Ref.make<readonly LogEntry[]>([])
  const client = HttpClient.make((request, url) =>
    Effect.gen(function* () {
      let matched: Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError> | undefined
      for (const route of routes) {
        matched = route.match(request, url)
        if (matched) break
      }
      const entry = {
        time: yield* Clock.currentTimeMillis,
        method: request.method,
        url: url.toString(),
        matched: matched !== undefined,
      }
      yield* Ref.update(log, (entries) => [...entries, entry].slice(-LOG_LIMIT))
      if (matched) return yield* matched
      return yield* Effect.fail(
        new HttpClientError({
          reason: new TransportError({
            request,
            description: `Simulation denied unregistered network destination: ${request.method} ${url}`,
          }),
        }),
      )
    }),
  )
  return { client, log: () => Ref.get(log) } satisfies Run
})

export const layer = (routes: readonly Route[] = []) =>
  Layer.effect(HttpClient.HttpClient, make(routes).pipe(Effect.map((run) => run.client)))

export * as SimulationNetwork from "./network"
