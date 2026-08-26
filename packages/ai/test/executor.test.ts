import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Ref, Stream } from "effect"
import { Headers, HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { LLM, AIError } from "../src/index.js"
import { LLMClient, RequestExecutor, WebSocketTransport, type WebSocketChannelExecutor } from "../src/route.js"
import * as OpenAIChat from "../src/protocols/openai-chat.js"
import * as OpenAI from "../src/providers/openai.js"
import { dynamicResponse, fixedResponse, systemError } from "./lib/http.js"
import { deltaChunk } from "./lib/openai-chunks.js"
import { sseEvents, sseRaw } from "./lib/sse.js"
import { it } from "./lib/effect.js"

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

const expectAIError = (error: unknown) => {
  expect(error).toBeInstanceOf(AIError)
  if (!(error instanceof AIError)) throw new Error("expected AIError")
  return error
}

const errorHttp = (error: AIError) => ("http" in error.reason ? error.reason.http : undefined)
const largeProviderMessage = `Upstream request failed: ${"validation failed; ".repeat(1_000)}`

describe("RequestExecutor", () => {
  it.effect("parses response body failures at the executor seam", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* RequestExecutor.stream(executor, secretRequest).pipe(Stream.runDrain, Effect.flip)

      expectAIError(error)
      expect(error.reason).toMatchObject({
        _tag: "Transport",
        message: "ECONNRESET: disconnected query-secret-123 header-secret-456",
        transport: "http",
        operation: "read",
        code: "ECONNRESET",
        url: "https://provider.test/v1/chat?api_key=query-secret-123&debug=1",
      })
    }).pipe(
      Effect.provide(
        responsesLayer([
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(systemError("ECONNRESET", "disconnected query-secret-123 header-secret-456"))
              },
            }),
          ),
        ]),
      ),
    ),
  )

  it.effect("unwraps native transport failure causes", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* RequestExecutor.stream(executor, secretRequest).pipe(Stream.runDrain, Effect.flip)

      expectAIError(error)
      expect(error.reason).toMatchObject({
        _tag: "Transport",
        message: "ECONNRESET: socket closed",
        operation: "read",
        code: "ECONNRESET",
      })
    }).pipe(
      Effect.provide(
        responsesLayer([
          new Response(
            new ReadableStream({
              pull(controller) {
                controller.error(new TypeError("fetch failed", { cause: systemError("ECONNRESET", "socket closed") }))
              },
            }),
          ),
        ]),
      ),
    ),
  )

  it.effect("preserves middleware error messages", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor
        .execute(request, () => Effect.fail(new Error("plugin rejected request")))
        .pipe(Effect.flip)

      expectAIError(error)
      expect(error.reason.message).toBe("plugin rejected request")
    }).pipe(Effect.provide(responsesLayer([]))),
  )

  it.effect("reports the request sent by middleware", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor
        .execute(request, (original, handler) =>
          handler(
            original.pipe(
              HttpClientRequest.setUrl("https://proxy.test/v1/chat?api_key=proxy-secret"),
              HttpClientRequest.setHeader("authorization", "Bearer proxy-secret"),
            ),
          ),
        )
        .pipe(Effect.flip)

      expectAIError(error)
      expect(error.reason).toMatchObject({
        _tag: "Transport",
        message: "ECONNRESET: proxy disconnected proxy-secret",
        url: "https://proxy.test/v1/chat?api_key=proxy-secret",
        http: {
          request: {
            url: "https://proxy.test/v1/chat?api_key=proxy-secret",
            headers: { authorization: "Bearer proxy-secret" },
          },
        },
      })
    }).pipe(
      Effect.provide(
        dynamicResponse((input) =>
          Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({
                request: input.request,
                cause: systemError("ECONNRESET", "proxy disconnected proxy-secret"),
              }),
            }),
          ),
        ),
      ),
    ),
  )

  it.effect("classifies context overflow responses", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectAIError(error)
      expect(error.reason).toMatchObject({ _tag: "InvalidRequest", classification: "context-overflow" })
    }).pipe(
      Effect.provide(
        responsesLayer([
          new Response('{"error":{"code":"context_length_exceeded","message":"prompt too long"}}', {
            status: 400,
          }),
        ]),
      ),
    ),
  )

  it.effect("classifies generic HTTP 413 payload errors", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectAIError(error)
      expect(error.reason).toMatchObject({
        _tag: "InvalidRequest",
        classification: "payload-too-large",
        http: { response: { status: 413 } },
      })
    }).pipe(Effect.provide(responsesLayer([new Response("request too large", { status: 413 })]))),
  )

  it.effect("classifies Anthropic request_too_large as context overflow", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectAIError(error)
      expect(error.reason).toMatchObject({
        _tag: "InvalidRequest",
        classification: "context-overflow",
        http: { response: { status: 413 } },
      })
    }).pipe(
      Effect.provide(
        responsesLayer([
          new Response('{"error":{"type":"request_too_large","message":"Request exceeds the maximum size"}}', {
            status: 413,
          }),
        ]),
      ),
    ),
  )

  it.effect("does not classify ordinary invalid requests as context overflow", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectAIError(error)
      expect(error.reason).toMatchObject({ _tag: "InvalidRequest" })
      expect("classification" in error.reason ? error.reason.classification : undefined).toBeUndefined()
      expect(error.reason.message).toBe("Provider request failed with HTTP 400")
    }).pipe(Effect.provide(responsesLayer([new Response("invalid parameter", { status: 400 })]))),
  )

  it.effect("preserves structured provider messages from large error bodies", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectAIError(error)
      expect(error.reason).toMatchObject({ _tag: "InvalidRequest", message: largeProviderMessage })
      expect(errorHttp(error)?.body).toContain(largeProviderMessage)
      expect(errorHttp(error)?.bodyTruncated).toBeUndefined()
    }).pipe(
      Effect.provide(
        responsesLayer([
          new Response(
            JSON.stringify({
              model: "gpt-5.6-sol",
              error: { type: "invalid_request", message: largeProviderMessage },
            }),
            { status: 400 },
          ),
        ]),
      ),
    ),
  )

  it.effect("falls back when structured provider messages are empty", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectAIError(error)
      expect(error.reason).toMatchObject({
        _tag: "InvalidRequest",
        message: "Provider request failed with HTTP 400",
      })
    }).pipe(Effect.provide(responsesLayer([new Response('{"error":{"message":"  "}}', { status: 400 })]))),
  )

  it.effect("classifies provider rate limits hidden behind HTTP 400", () =>
    Effect.gen(function* () {
      const classify = (body: string) =>
        Effect.gen(function* () {
          const executor = yield* RequestExecutor.Service
          const error = yield* executor.execute(request).pipe(Effect.flip)

          expectAIError(error)
          expect(error.reason).toMatchObject({ _tag: "RateLimit" })
        }).pipe(Effect.provide(responsesLayer([new Response(body, { status: 400 })])))

      yield* classify("Request rate increased too quickly")
      yield* classify('{"type":"error","error":{"type":"too_many_requests"}}')
      yield* classify('{"type":"error","error":{"code":"rate_limit_exceeded"}}')
    }),
  )

  it.effect("classifies provider overloads hidden behind HTTP 400", () =>
    Effect.gen(function* () {
      const classify = (body: string) =>
        Effect.gen(function* () {
          const executor = yield* RequestExecutor.Service
          const error = yield* executor.execute(request).pipe(Effect.flip)

          expectAIError(error)
          expect(error.reason).toMatchObject({ _tag: "ProviderInternal" })
        }).pipe(Effect.provide(responsesLayer([new Response(body, { status: 400 })])))

      yield* classify('{"code":"resource_exhausted"}')
      yield* classify('{"code":"service_unavailable"}')
    }),
  )

  it.effect("returns complete diagnostics for rate limits", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectAIError(error)
      expect(error).toMatchObject({
        reason: {
          _tag: "RateLimit",
          retryAfterMs: 0,
          rateLimit: { retryAfterMs: 0 },
          http: {
            request: {
              method: "POST",
              url: "https://provider.test/v1/chat?api_key=secret&key=secret&debug=1",
              headers: { authorization: "Bearer secret", "x-safe": "visible" },
            },
            response: {
              status: 429,
              headers: {
                "retry-after-ms": "0",
                "x-request-id": "req_123",
                "x-api-key": "secret",
              },
            },
          },
        },
      })
      expect(errorHttp(error)?.body).toBe("rate limited")
    }).pipe(
      Effect.provide(
        responsesLayer([
          new Response("rate limited", {
            status: 429,
            headers: { "retry-after-ms": "0", "x-request-id": "req_123", "x-api-key": "secret" },
          }),
        ]),
      ),
    ),
  )

  it.effect("preserves configured header names in diagnostics", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectAIError(error)
      expect(errorHttp(error)?.request.headers["x-safe"]).toBe("visible")
      expect(errorHttp(error)?.response?.headers["x-safe"]).toBe("response-secret")
    }).pipe(
      Effect.provide(responsesLayer([new Response("bad", { status: 400, headers: { "x-safe": "response-secret" } })])),
      Effect.provideService(Headers.CurrentRedactedNames, ["x-safe"]),
    ),
  )

  it.effect("extracts OpenAI-style rate-limit diagnostics", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectAIError(error)
      expect(error.reason).toMatchObject({ _tag: "RateLimit" })
      expect(error.reason._tag === "RateLimit" ? error.reason.rateLimit : undefined).toEqual({
        retryAfterMs: 0,
        limit: { requests: "500", tokens: "30000" },
        remaining: { requests: "499", tokens: "29900" },
        reset: { requests: "1s", tokens: "10s" },
      })
    }).pipe(
      Effect.provide(
        responsesLayer([
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
        ]),
      ),
    ),
  )

  it.effect("extracts Anthropic-style rate-limit diagnostics", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectAIError(error)
      expect(error.reason).toMatchObject({ _tag: "ProviderInternal" })
      expect(errorHttp(error)?.rateLimit).toEqual({
        retryAfterMs: 0,
        limit: { requests: "100", "input-tokens": "10000" },
        remaining: { requests: "12", "input-tokens": "9000" },
        reset: { requests: "2026-05-06T12:00:00Z", "input-tokens": "2026-05-06T12:00:10Z" },
      })
    }).pipe(
      Effect.provide(
        responsesLayer([
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
        ]),
      ),
    ),
  )

  it.effect("returns provider status failures without retrying", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const error = yield* Effect.gen(function* () {
        const executor = yield* RequestExecutor.Service
        return yield* executor.execute(request).pipe(Effect.flip)
      }).pipe(
        Effect.provide(
          countedResponsesLayer(attempts, [
            new Response("busy", { status: 503, headers: { "retry-after-ms": "0" } }),
            new Response("ok", { status: 200 }),
          ]),
        ),
      )

      expectAIError(error)
      expect(error.reason).toMatchObject({ _tag: "ProviderInternal", status: 503 })
      expect(yield* Ref.get(attempts)).toBe(1)
    }),
  )

  it.effect("marks 504 and 529 status responses as provider-internal", () =>
    Effect.gen(function* () {
      const failWith = (status: number) =>
        Effect.gen(function* () {
          const executor = yield* RequestExecutor.Service
          const error = yield* executor.execute(request).pipe(Effect.flip)

          expectAIError(error)
          expect(error.reason).toMatchObject({ _tag: "ProviderInternal", status })
        }).pipe(
          Effect.provide(
            responsesLayer([
              new Response("provider failure", {
                status,
                headers: { "retry-after-ms": "0" },
              }),
            ]),
          ),
        )

      yield* failWith(504)
      yield* failWith(529)
    }),
  )

  it.effect("preserves large authentication error bodies", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectAIError(error)
      expect(error.reason).toMatchObject({ _tag: "Authentication" })
      expect(errorHttp(error)?.bodyTruncated).toBeUndefined()
      expect(errorHttp(error)?.body).toHaveLength(20_000)
    }).pipe(
      Effect.provide(
        responsesLayer([
          new Response("x".repeat(20_000), { status: 401 }),
          new Response("should not retry", { status: 200 }),
        ]),
      ),
    ),
  )

  it.effect("preserves response body fields", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectAIError(error)
      expect(errorHttp(error)?.body).toBe(
        '{"error":{"message":"bad","key":"body-secret","detail":"api_key=query-secret"}}',
      )
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

  it.effect("preserves echoed request values in response bodies", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(secretRequest).pipe(Effect.flip)

      expectAIError(error)
      expect(errorHttp(error)?.body).toBe("provider echoed query-secret-123 and authorization header-secret-456")
    }).pipe(
      Effect.provide(
        responsesLayer([
          new Response("provider echoed query-secret-123 and authorization header-secret-456", { status: 400 }),
        ]),
      ),
    ),
  )

  it.effect("does not re-execute after a successful response reaches stream parsing", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const model = OpenAIChat.route
        .with({ endpoint: { baseURL: "https://api.openai.test/v1" } })
        .model({ id: "gpt-4o-mini" })
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

      expectAIError(error)
      expect(error.reason).toMatchObject({ _tag: "InvalidProviderOutput" })
      expect(yield* Ref.get(attempts)).toBe(1)
    }),
  )
})

describe("WebSocket channel execution", () => {
  const model = OpenAI.configure({ baseURL: "https://api.openai.test/v1/", apiKey: "test" }).responses("gpt-4.1-mini")
  const request = LLM.request({ model, prompt: "Say hello." })
  const frames = [
    JSON.stringify({ type: "response.output_text.delta", item_id: "msg_1", delta: "Hi" }),
    JSON.stringify({ type: "response.completed", response: { id: "resp_1" } }),
  ]

  it.effect("runs a channel driver through the direct executor", () =>
    Effect.gen(function* () {
      const sent = yield* Ref.make("")
      const closed = yield* Ref.make(false)
      const observed = yield* Ref.make(0)
      const webSocket = WebSocketTransport.makeDirect({
        open: () =>
          Effect.succeed({
            sendText: (message) => Ref.set(sent, message),
            messages: Stream.make("one", "done", "late"),
            close: Ref.set(closed, true),
          }),
      })
      const received = yield* Effect.scoped(
        Effect.gen(function* () {
          const execution = yield* webSocket.execute({
            id: "exchange_1",
            connect: { url: "wss://api.openai.test/v1/responses", headers: Headers.empty },
            fallback: () => Stream.empty,
            driver: {
              create: () => Effect.succeed({ message: "create", mode: "full" }),
              observe: (_create, frame) =>
                Ref.update(observed, (value) => value + 1).pipe(
                  Effect.as(
                    frame === "done" ? { type: "completed" as const, frame } : { type: "frame" as const, frame },
                  ),
                ),
            },
          })
          return yield* Stream.runCollect(execution.frames)
        }),
      )

      expect(Array.from(received)).toEqual(["one", "done"])
      expect(yield* Ref.get(sent)).toBe("create")
      expect(yield* Ref.get(observed)).toBe(2)
      expect(yield* Ref.get(closed)).toBe(true)
    }),
  )

  it.effect("rejects a closed socket before attempting to send", () =>
    Effect.gen(function* () {
      class ClosedBeforeSend extends EventTarget {
        readyState = globalThis.WebSocket.OPEN
        sends = 0
        send() {
          this.sends++
        }
        close() {}
      }
      const socket = new ClosedBeforeSend()
      const connection = yield* WebSocketTransport.fromWebSocket(
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        socket as unknown as globalThis.WebSocket,
        { url: "wss://api.openai.test/v1/responses", headers: Headers.empty },
      )
      socket.readyState = globalThis.WebSocket.CLOSED

      const error = yield* connection.sendText("create").pipe(Effect.flip)

      expect(error.reason).toMatchObject({ _tag: "Transport", phase: "send", delivery: "not-sent" })
      expect(socket.sends).toBe(0)
      yield* connection.close
    }),
  )

  it.effect("uses HTTP when no per-call WebSocket executor is provided", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(Effect.provide(fixedResponse(sseEvents(...frames))))

      expect(response.text).toBe("Hi")
    }),
  )

  it.effect("commits channel execution only after complete consumption", () =>
    Effect.gen(function* () {
      const commits = yield* Ref.make(0)
      const executor = (input: Stream.Stream<string, AIError>): WebSocketChannelExecutor => ({
        execute: () =>
          Effect.succeed({
            frames: input,
            complete: Ref.update(commits, (value) => value + 1),
          }),
      })

      const response = yield* LLMClient.generate(request, {
        webSocket: executor(Stream.fromArray(frames)),
      }).pipe(Effect.provide(fixedResponse("")))
      expect(response.text).toBe("Hi")
      expect(yield* Ref.get(commits)).toBe(1)

      yield* LLMClient.generate(request, { webSocket: executor(Stream.make("not-json")) }).pipe(
        Effect.provide(fixedResponse("")),
        Effect.flip,
      )
      expect(yield* Ref.get(commits)).toBe(1)

      yield* LLMClient.stream(request, { webSocket: executor(Stream.fromArray(frames)) }).pipe(
        Stream.take(1),
        Stream.runDrain,
        Effect.provide(fixedResponse("")),
      )
      expect(yield* Ref.get(commits)).toBe(1)
    }),
  )

  it.effect("does not commit interrupted channel execution", () =>
    Effect.gen(function* () {
      const commits = yield* Ref.make(0)
      const started = yield* Deferred.make<void>()
      const executor: WebSocketChannelExecutor = {
        execute: () =>
          Effect.succeed({
            frames: Stream.fromEffect(
              Deferred.succeed(started, undefined).pipe(
                Effect.as(JSON.stringify({ type: "response.created", response: { id: "resp_1" } })),
              ),
            ).pipe(Stream.concat(Stream.never)),
            complete: Ref.update(commits, (value) => value + 1),
          }),
      }
      const fiber = yield* LLMClient.stream(request, { webSocket: executor }).pipe(
        Stream.runDrain,
        Effect.provide(fixedResponse("")),
        Effect.forkChild({ startImmediately: true }),
      )

      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)

      expect(yield* Ref.get(commits)).toBe(0)
    }),
  )
})
