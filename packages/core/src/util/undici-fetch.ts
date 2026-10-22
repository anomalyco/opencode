export * as UndiciFetch from "./undici-fetch.js"

import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { create } from "#undici-fetch"
import { lazy } from "./lazy.js"

type Fetch = typeof globalThis.fetch

export { create }

/** One process-wide fetch, so every model shares the Agent's connection pool. */
export const shared = lazy(() => create())

/**
 * Wraps the HttpClient in scope so a fetch-based one sends through `send()` when the runtime needs one. The
 * fetch is resolved when the layer is built, not when this module loads. A client that does not use fetch,
 * such as a test double or recorder, is left in charge.
 */
export function layer(send: () => Fetch | undefined = shared) {
  return Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient
      const fetch = send()
      if (!fetch) return client
      return HttpClient.transform(client, (effect) => Effect.provideService(effect, FetchHttpClient.Fetch, fetch))
    }),
  )
}
