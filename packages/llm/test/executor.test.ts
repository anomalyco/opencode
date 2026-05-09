import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer, Random, Ref } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { Headers, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { LLM, LLMError } from "../src"
import { LLMClient, RequestExecutor } from "../src/route"
import * as OpenAIChat from "../src/protocols/openai-chat"
import { dynamicResponse } from "./lib/http"
import { deltaChunk } from "./lib/openai-chunks"
import { sseRaw } from "./lib/sse"
import { it } from "./lib/effect"

const request = HttpClientRequest.post("https://provider.test/v1/chat?api_key=secret&key=secret&debug=1").pipe(
  HttpClientRequest.setHeaders(Headers.fromInput({ authorization: "Bearer secret", "x-safe": "visible" })),
)

const secretRequest = HttpClientRequest.post("https://provider.test/v1/chat?api_key=query-secret-123&debug=1").pipe(
  HttpClientRequest.setHeaders(Headers.fromInput({ authorization: "Bearer header-secret-456" })),
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

const countedResponsesLayer = (attempts: Ref.Ref<number>, responses: ReadonlyArray<Response>) =>
  RequestExecutor.layer.pipe(
    Layer.provide(
      Layer.unwrap(
        Effect.gen(function* () {
          const cursor = yield* Ref.make(0)
          return Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Effect.gen(function* () {
                yield* Ref.update(attempts, (value) => value + 1)
                const index = yield* Ref.getAndUpdate(cursor, (value) => value + 1)
                return HttpClientResponse.fromWeb(request, responses[index] ?? responses[responses.length - 1])
              }),
            ),
          )
        }),
      ),
    ),
  )

const randomMidpoint = {
  nextDoubleUnsafe: () => 0.5,
  nextIntUnsafe: () => 0,
}

const expectLLMError = (error: unknown) => {
  expect(error).toBeInstanceOf(LLMError)
  if (!(error instanceof LLMError)) throw new Error("expected LLMError")
  return error
}

const errorHttp = (error: LLMError) => ("http" in error.reason ? error.reason.http : undefined)

describe("RequestExecutor", () => {
  it.effect("returns redacted diagnostics for retryable rate limits", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectLLMError(error)
      expect(error).toMatchObject({
        retryable: true,
        retryAfterMs: 0,
        reason: {
          _tag: "RateLimit",
          rateLimit: { retryAfterMs: 0 },
          http: {
            requestId: "req_123",
            request: {
              method: "POST",
              url: "https://provider.test/v1/chat?api_key=%3Credacted%3E&key=%3Credacted%3E&debug=1",
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
          },
        },
      })
      expect(errorHttp(error)?.body).toBe("rate limited")
    }).pipe(
      Effect.provide(
        responsesLayer([
          ...Array.from(
            { length: 3 },
            () =>
              new Response("rate limited", {
                status: 429,
                headers: { "retry-after-ms": "0", "x-request-id": "req_123", "x-api-key": "secret" },
              }),
          ),
        ]),
      ),
    ),
  )

  it.effect("honors current redacted header names in diagnostics", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectLLMError(error)
      expect(errorHttp(error)?.request.headers["x-safe"]).toBe("<redacted>")
      expect(errorHttp(error)?.response?.headers["x-safe"]).toBe("<redacted>")
    }).pipe(
      Effect.provide(responsesLayer([new Response("bad", { status: 400, headers: { "x-safe": "response-secret" } })])),
      Effect.provideService(Headers.CurrentRedactedNames, ["x-safe"]),
    ),
  )

  it.effect("extracts OpenAI-style rate-limit diagnostics", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectLLMError(error)
      expect(error.reason).toMatchObject({ _tag: "RateLimit" })
      expect(error.reason._tag === "RateLimit" ? error.reason.rateLimit : undefined).toEqual({
        retryAfterMs: 0,
        limit: { requests: "500", tokens: "30000" },
        remaining: { requests: "499", tokens: "29900" },
        reset: { requests: "1s", tokens: "10s" },
      })
    }).pipe(
      Effect.provide(
        responsesLayer(
          Array.from(
            { length: 3 },
            () =>
              new Response("rate limited", {
                status: 429,
                headers: {
                  "retry-after-ms": "0",
                  "x-ratelimit-limit-requests": "500",
                  "x-ratelimit-limit-tokens": "30000",
                  "x-ratelimit-remaining-requests": "499",
                  "x-ratelimit-remaining-tokens": "29900",
                  "x-ratelimit-reset-requests": "1s",
                  "x-ratelimit-reset-tokens": "10s",
                },
              }),
          ),
        ),
      ),
    ),
  )

  it.effect("extracts Anthropic-style rate-limit diagnostics", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectLLMError(error)
      expect(error.reason).toMatchObject({ _tag: "ProviderInternal" })
      expect(errorHttp(error)?.rateLimit).toEqual({
        retryAfterMs: 0,
        limit: { requests: "100", "input-tokens": "10000" },
        remaining: { requests: "12", "input-tokens": "9000" },
        reset: { requests: "2026-05-06T12:00:00Z", "input-tokens": "2026-05-06T12:00:10Z" },
      })
    }).pipe(
      Effect.provide(
        responsesLayer(
          Array.from(
            { length: 3 },
            () =>
              new Response("overloaded", {
                status: 529,
                headers: {
                  "retry-after-ms": "0",
                  "anthropic-ratelimit-requests-limit": "100",
                  "anthropic-ratelimit-requests-remaining": "12",
                  "anthropic-ratelimit-requests-reset": "2026-05-06T12:00:00Z",
                  "anthropic-ratelimit-input-tokens-limit": "10000",
                  "anthropic-ratelimit-input-tokens-remaining": "9000",
                  "anthropic-ratelimit-input-tokens-reset": "2026-05-06T12:00:10Z",
                },
              }),
          ),
        ),
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

  it.effect("marks 504 and 529 status responses retryable", () =>
    Effect.gen(function* () {
      const failWith = (status: number) =>
        Effect.gen(function* () {
          const executor = yield* RequestExecutor.Service
          const error = yield* executor.execute(request).pipe(Effect.flip)

          expectLLMError(error)
          expect(error.reason).toMatchObject({ _tag: "ProviderInternal", status })
          expect(error.retryable).toBe(true)
        }).pipe(
          Effect.provide(
            responsesLayer(
              Array.from(
                { length: 3 },
                () =>
                  new Response("retry", {
                    status,
                    headers: { "retry-after-ms": "0" },
                  }),
              ),
            ),
          ),
        )

      yield* failWith(504)
      yield* failWith(529)
    }),
  )

  it.effect("does not retry non-retryable status responses and truncates large bodies", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectLLMError(error)
      expect(error.reason).toMatchObject({ _tag: "Authentication" })
      expect(error.retryable).toBe(false)
      expect(errorHttp(error)?.bodyTruncated).toBe(true)
      expect(errorHttp(error)?.body).toHaveLength(16_384)
    }).pipe(
      Effect.provide(
        responsesLayer([
          new Response("x".repeat(20_000), { status: 401 }),
          new Response("should not retry", { status: 200 }),
        ]),
      ),
    ),
  )

  it.effect("redacts common secret fields in response bodies", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectLLMError(error)
      expect(errorHttp(error)?.body).toContain('"key":"<redacted>"')
      expect(errorHttp(error)?.body).toContain("api_key=<redacted>")
      expect(errorHttp(error)?.body).not.toContain("body-secret")
      expect(errorHttp(error)?.body).not.toContain("query-secret")
    }).pipe(
      Effect.provide(
        responsesLayer([
          new Response('{"error":{"message":"bad","key":"body-secret","detail":"api_key=query-secret"}}', {
            status: 400,
          }),
        ]),
      ),
    ),
  )

  it.effect("redacts echoed request secret values in response bodies", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(secretRequest).pipe(Effect.flip)

      expectLLMError(error)
      expect(errorHttp(error)?.body).toContain("provider echoed <redacted>")
      expect(errorHttp(error)?.body).toContain("authorization <redacted>")
      expect(errorHttp(error)?.body).not.toContain("query-secret-123")
      expect(errorHttp(error)?.body).not.toContain("header-secret-456")
    }).pipe(
      Effect.provide(
        responsesLayer([
          new Response("provider echoed query-secret-123 and authorization header-secret-456", { status: 400 }),
        ]),
      ),
    ),
  )

  it.effect("honors Retry-After delta seconds before retrying", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      return yield* Effect.gen(function* () {
        const executor = yield* RequestExecutor.Service
        const fiber = yield* executor.execute(request).pipe(Effect.forkChild)

        yield* Effect.yieldNow
        expect(yield* Ref.get(attempts)).toBe(1)

        yield* TestClock.adjust(1_999)
        yield* Effect.yieldNow
        expect(yield* Ref.get(attempts)).toBe(1)

        yield* TestClock.adjust(1)
        const response = yield* Fiber.join(fiber)

        expect(response.status).toBe(200)
        expect(yield* Ref.get(attempts)).toBe(2)
      }).pipe(
        Effect.provide(
          countedResponsesLayer(attempts, [
            new Response("busy", { status: 503, headers: { "retry-after": "2" } }),
            new Response("ok", { status: 200 }),
          ]),
        ),
      )
    }),
  )

  it.effect("uses exponential jittered delay when retry-after is absent", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      return yield* Effect.gen(function* () {
        const executor = yield* RequestExecutor.Service
        const fiber = yield* executor.execute(request).pipe(Effect.flip, Effect.forkChild)

        yield* Effect.yieldNow
        expect(yield* Ref.get(attempts)).toBe(1)

        yield* TestClock.adjust(499)
        yield* Effect.yieldNow
        expect(yield* Ref.get(attempts)).toBe(1)

        yield* TestClock.adjust(1)
        yield* Effect.yieldNow
        expect(yield* Ref.get(attempts)).toBe(2)

        yield* TestClock.adjust(999)
        yield* Effect.yieldNow
        expect(yield* Ref.get(attempts)).toBe(2)

        yield* TestClock.adjust(1)
        const error = yield* Fiber.join(fiber)

        expectLLMError(error)
        expect(error.reason).toMatchObject({ _tag: "ProviderInternal" })
        expect(yield* Ref.get(attempts)).toBe(3)
      }).pipe(
        Effect.provide(
          countedResponsesLayer(attempts, [
            new Response("busy", { status: 503 }),
            new Response("still busy", { status: 503 }),
            new Response("done retrying", { status: 503 }),
          ]),
        ),
      )
    }).pipe(Effect.provideService(Random.Random, randomMidpoint)),
  )

  it.effect("does not retry after a successful response reaches stream parsing", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const model = OpenAIChat.model({ id: "gpt-4o-mini", baseURL: "https://api.openai.test/v1" })
      const error = yield* LLMClient.generate(LLM.request({ model, prompt: "Say hello." })).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Ref.update(attempts, (value) => value + 1).pipe(
              Effect.as(
                input.respond(
                  sseRaw(
                    `data: ${JSON.stringify(deltaChunk({ role: "assistant", content: "Hello" }))}`,
                    "data: not-json",
                  ),
                  { headers: { "content-type": "text/event-stream" } },
                ),
              ),
            ),
          ),
        ),
        Effect.flip,
      )

      expectLLMError(error)
      expect(error.reason).toMatchObject({ _tag: "InvalidProviderOutput" })
      expect(yield* Ref.get(attempts)).toBe(1)
    }),
  )
})
