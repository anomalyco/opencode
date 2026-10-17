export * as UndiciFetch from "./undici-fetch.js"

import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { Agent, fetch as undiciFetch } from "undici"
import { lazy } from "./lazy.js"

type Fetch = typeof globalThis.fetch

// Node's built-in fetch enforces undici's default 300s headersTimeout and bodyTimeout, which kills slow
// providers and SSE streams with long gaps regardless of the provider's own timeout settings. Those limits
// are already enforced above this layer (headerTimeout, chunkTimeout, timeout), so the socket-level ones are
// turned off. The Agent only works with undici's own fetch: Node's bundled undici rejects an undici@8 Agent
// (UND_ERR_INVALID_ARG). Bun's fetch has no such defaults, so it keeps its own.
export function create(runtime: { readonly bun?: string } = process.versions): Fetch | undefined {
  if (runtime.bun) return undefined
  const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 })
  return Object.assign(
    (input: Parameters<Fetch>[0], init?: RequestInit) =>
      undiciFetch(input as Parameters<typeof undiciFetch>[0], { ...(init as object), dispatcher }) as unknown as Promise<Response>,
    { preconnect: globalThis.fetch.preconnect },
  )
}

/** One process-wide fetch, so every model shares the Agent's connection pool. */
export const shared = lazy(() => create())

/**
 * Wraps the HttpClient in scope so a fetch-based one sends through `send` when the runtime needs one. A client
 * that does not use fetch, such as a test double or recorder, is left in charge.
 */
export function layer(send: Fetch | undefined = shared()) {
  return Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient
      if (!send) return client
      return HttpClient.transform(client, (effect) => Effect.provideService(effect, FetchHttpClient.Fetch, send))
    }),
  )
}
