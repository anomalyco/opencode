// Task 1 probe: confirm the Effect FetchHttpClient seam accepts an injected fetch,
// so the proxy dispatcher can be installed at the shared httpClient node.
import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"

test("shared http client uses the injected fetch", async () => {
  let calls = 0
  const fakeFetch = (async () => {
    calls++
    return new Response("ok")
  }) as typeof fetch

  const layer = FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fakeFetch)))
  const client = await Effect.runPromise(HttpClient.HttpClient.pipe(Effect.provide(layer)))
  const response = await Effect.runPromise(client.execute(HttpClientRequest.get("https://example.invalid/")))

  expect(calls).toBe(1)
  expect(response.status).toBe(200)
})
