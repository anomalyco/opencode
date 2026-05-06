import { describe, expect } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import { Headers, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { ProviderRequestError } from "../src"
import { RequestExecutor } from "../src/adapter"
import { it } from "./lib/effect"

const request = HttpClientRequest.post("https://provider.test/v1/chat?api_key=secret&debug=1").pipe(
  HttpClientRequest.setHeaders(Headers.fromInput({ authorization: "Bearer secret", "x-safe": "visible" })),
)

const responsesLayer = (responses: ReadonlyArray<Response>) =>
  RequestExecutor.layer.pipe(
    Layer.provide(
      Layer.unwrap(
        Effect.gen(function* () {
          const cursor = yield* Ref.make(0)
          return Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Effect.gen(function* () {
                const index = yield* Ref.getAndUpdate(cursor, (value) => value + 1)
                return HttpClientResponse.fromWeb(request, responses[index] ?? responses[responses.length - 1])
              }),
            ),
          )
        }),
      ),
    ),
  )

describe("RequestExecutor", () => {
  it.effect("returns redacted diagnostics for retryable rate limits", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expect(error).toBeInstanceOf(ProviderRequestError)
      if (!(error instanceof ProviderRequestError)) throw new Error("expected ProviderRequestError")
      expect(error).toMatchObject({
        status: 429,
        retryable: true,
        retryAfterMs: 0,
        requestId: "req_123",
        request: {
          method: "POST",
          url: "https://provider.test/v1/chat?api_key=%3Credacted%3E&debug=1",
          headers: { authorization: "<redacted>", "x-safe": "visible" },
        },
        response: {
          status: 429,
          headers: {
            "retry-after-ms": "0",
            "x-request-id": "req_123",
            "x-api-key": "<redacted>",
          },
        },
      })
      expect(error.body).toBe("rate limited")
    }).pipe(
      Effect.provide(
        responsesLayer([
          ...Array.from({ length: 3 }, () => new Response("rate limited", {
            status: 429,
            headers: { "retry-after-ms": "0", "x-request-id": "req_123", "x-api-key": "secret" },
          })),
        ]),
      ),
    ),
  )

  it.effect("retries retryable status responses before returning the stream", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const response = yield* executor.execute(request)

      expect(response.status).toBe(200)
      expect(yield* response.text).toBe("ok")
    }).pipe(
      Effect.provide(
        responsesLayer([
          new Response("busy", { status: 503, headers: { "retry-after-ms": "0" } }),
          new Response("ok", { status: 200 }),
        ]),
      ),
    ),
  )

  it.effect("does not retry non-retryable status responses and truncates large bodies", () => {
    return Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expect(error).toBeInstanceOf(ProviderRequestError)
      if (!(error instanceof ProviderRequestError)) throw new Error("expected ProviderRequestError")
      expect(error.retryable).toBe(false)
      expect(error.bodyTruncated).toBe(true)
      expect(error.body).toHaveLength(16_384)
    }).pipe(
      Effect.provide(
        responsesLayer([
          new Response("x".repeat(20_000), { status: 401 }),
          new Response("should not retry", { status: 200 }),
        ]),
      ),
    )
  })
})
