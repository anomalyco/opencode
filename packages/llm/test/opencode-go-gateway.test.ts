import { describe, expect } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import { Headers, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { LLMError } from "../src"
import { RequestExecutor } from "../src/route"
import { it } from "./lib/effect"

const request = HttpClientRequest.post("https://opencode.ai/zen/go/v1/messages").pipe(
  HttpClientRequest.setHeaders(Headers.fromInput({ "x-api-key": "test" })),
)

const responsesLayer = (responses: ReadonlyArray<Response>) =>
  RequestExecutor.layer.pipe(
    Layer.provide(
      Layer.unwrap(
        Effect.gen(function* () {
          const cursor = yield* Ref.make(0)
          return Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((req) =>
              Effect.gen(function* () {
                const index = yield* Ref.getAndUpdate(cursor, (value) => value + 1)
                return HttpClientResponse.fromWeb(req, responses[index] ?? responses[responses.length - 1])
              }),
            ),
          )
        }),
      ),
    ),
  )

const expectLLMError = (error: unknown) => {
  expect(error).toBeInstanceOf(LLMError)
  if (!(error instanceof LLMError)) throw new Error("expected LLMError")
  return error
}

const httpBody = (error: LLMError) => ("http" in error.reason ? error.reason.http?.body : undefined)

describe("opencode-go gateway 400", () => {
  it.effect("classifies gateway input-limit rejection as context overflow and surfaces the body", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectLLMError(error)
      expect(error.reason).toMatchObject({ _tag: "InvalidRequest", classification: "context-overflow" })
      expect(error.message).toContain("Input exceeds maximum input length of 148000 tokens")
      expect(httpBody(error)).toContain("Input exceeds maximum input length")
    }).pipe(
      Effect.provide(
        responsesLayer([
          new Response(
            JSON.stringify({
              error: { type: "invalid_request_error", message: "Input exceeds maximum input length of 148000 tokens" },
            }),
            { status: 400 },
          ),
        ]),
      ),
    ),
  )

  it.effect("surfaces long rejection bodies instead of returning a bare status message", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectLLMError(error)
      expect(error.reason).toMatchObject({ _tag: "InvalidRequest", classification: "context-overflow" })
      expect(error.message).toContain("HTTP 400")
      expect(error.message).not.toBe("RequestExecutor.execute: Provider request failed with HTTP 400")
      expect(httpBody(error)).toContain("Input exceeds 148000 tokens")
    }).pipe(
      Effect.provide(
        responsesLayer([
          new Response(
            JSON.stringify({
              error: {
                type: "invalid_request_error",
                message: `Input exceeds 148000 tokens: ${"x".repeat(800)}`,
              },
            }),
            { status: 400 },
          ),
        ]),
      ),
    ),
  )

  it.effect("surfaces non-overflow 400 bodies without misclassifying them", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectLLMError(error)
      expect(error.reason).toMatchObject({ _tag: "InvalidRequest" })
      expect("classification" in error.reason ? error.reason.classification : undefined).toBeUndefined()
      expect(error.message).toContain("invalid parameter")
    }).pipe(Effect.provide(responsesLayer([new Response("invalid parameter", { status: 400 })]))),
  )
})
