import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { HttpClientError, TransportError } from "effect/unstable/http/HttpClientError"
import type { HttpClientRequest } from "effect/unstable/http"

/**
 * Simulated network.
 *
 * Replaces the `HttpClient.HttpClient` platform node in simulation mode. All
 * outbound HTTP resolves against an in-memory route table; unknown
 * destinations fail loudly with a transport error so no simulation run can
 * silently reach the real network. The scripted LLM is one registered route,
 * not a separate mechanism.
 *
 * The route table is process-global module state so the control surface and
 * the client layer observe the same registrations.
 */

export interface Route {
  /** Return a response effect to claim the request, undefined to pass. */
  readonly match: (
    request: HttpClientRequest.HttpClientRequest,
    url: URL,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse> | undefined
}

interface LogEntry {
  readonly time: number
  readonly method: string
  readonly url: string
  readonly matched: boolean
}

const state = {
  routes: [] as Route[],
  log: [] as LogEntry[],
}

const LOG_LIMIT = 1000

export function register(route: Route) {
  state.routes.push(route)
  return () => {
    const index = state.routes.indexOf(route)
    if (index >= 0) state.routes.splice(index, 1)
  }
}

/** Static JSON route: exact method + origin/path match answered with a fixed body. */
export function json(method: string, url: string, body: unknown): Route {
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

export function log(): readonly LogEntry[] {
  return state.log
}

function record(entry: LogEntry) {
  state.log.push(entry)
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT)
}

export const layer = Layer.sync(HttpClient.HttpClient)(() =>
  HttpClient.make((request, url) =>
    Effect.suspend(() => {
      const matched = state.routes
        .map((route) => route.match(request, url))
        .find((response) => response !== undefined)
      record({ time: Date.now(), method: request.method, url: url.toString(), matched: matched !== undefined })
      if (matched) return matched
      return Effect.fail(
        new HttpClientError({
          reason: new TransportError({
            request,
            description: `Simulation denied unregistered network destination: ${request.method} ${url}`,
          }),
        }),
      )
    }),
  ),
)

export * as SimulationNetwork from "./network"
