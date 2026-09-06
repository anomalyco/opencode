import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Ref, Stream } from "effect"
import { Headers, HttpClientError, HttpClientRequest } from "effect/unstable/http"
import {
  LLM,
  AIError,
  AuthenticationError,
  HttpContext,
  InvalidProviderOutputError,
  TransportError,
} from "../src/index.js"
import { LLMClient, RequestExecutor, WebSocketTransport, type WebSocketChannelExecutor } from "../src/route.js"
import { route } from "../src/protocols/openai-chat.js"
import { configure } from "../src/providers/openai.js"
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

const expectAIError = (error: unknown) => {
  expect(error).toBeInstanceOf(AIError)
  if (!(error instanceof AIError)) throw new Error("expected AIError")
  expect(error.reason).toBeInstanceOf(Error)
  expect(error.cause).toBe(error.reason)
  return error
}

const largeProviderMessage = `Upstream request failed: ${"validation failed; ".repeat(1_000)}`

describe("RequestExecutor", () => {
  it.effect("preserves authentication errors from HTTP middleware", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = new AIError({ reason: new AuthenticationError({ message: "Token request failed" }) })
      expect(yield* executor.execute(request, () => error).pipe(Effect.flip)).toBe(error)
    }).pipe(Effect.provide(fixedResponse("unused", {}))),
  )

  it.effect("preserves externally captured HTTP errors without inventing response context", () =>
    Effect.sync(() => {
      const cause = new Error("upstream request failed")
      const body = '{"error":{"message":"Rate limited","trace":"original"}}'
      const error = RequestExecutor.httpFailure({
        message: "Rate limited",
        url: request.url,
        status: 429,
        responseHeaders: { "Retry-After": "2", "X-Request-ID": "req_external" },
        responseBody: body,
        cause,
      })

      expect(error.message).toBe("Rate limited")
      expect(error.reason).toMatchObject({ _tag: "RateLimit", retryAfterMs: 2000 })
      expect(error.reason.body).toBe(body)
      expect(error.reason.cause).toBe(cause)
      expect(error.reason.http).toEqual(
        new HttpContext({
          url: request.url,
          status: 429,
          headers: { "retry-after": "2", "x-request-id": "req_external" },
        }),
      )
      expect(RequestExecutor.httpFailure({ message: "No response", url: request.url }).reason.http).toBeUndefined()
      expect(RequestExecutor.httpFailure({ message: "No URL", status: 500 }).reason.http).toBeUndefined()
    }),
  )

  it.effect("retains the original body-read failure on an HTTP status error", () =>
    Effect.gen(function* () {
      const cause = new Error("response body disconnected")
      const error = yield* Effect.gen(function* () {
        const executor = yield* RequestExecutor.Service
        return yield* executor.execute(request).pipe(Effect.flip)
      }).pipe(
        Effect.provide(
          fixedResponse(
            new ReadableStream({
              start(controller) {
                controller.error(cause)
              },
            }),
            {
              status: 503,
              headers: { "x-request-id": "req_failed_body" },
            },
          ),
        ),
      )

      expect(error.reason._tag).toBe("ProviderInternal")
      expect(error.reason.cause).toBe(cause)
      expect(error.reason.body).toBeUndefined()
      expect(error.reason.http).toMatchObject({ status: 503, headers: { "x-request-id": "req_failed_body" } })
    }),
  )

  it.effect("parses response body failures at the executor seam", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* RequestExecutor.stream(executor, secretRequest).pipe(Stream.runDrain, Effect.flip)

      expectAIError(error)
      expect(error.message).toBe("ECONNRESET: disconnected query-secret-123 header-secret-456")
      expect(error.reason.http).toMatchObject({ status: 200, url: secretRequest.url })
      expect(error.reason.cause).toMatchObject({ code: "ECONNRESET" })
      expect(error.reason).toMatchObject({
        _tag: "Transport",
        transport: "http",
        operation: "read",
        code: "ECONNRESET",
        url: "https://provider.test/v1/chat?api_key=query-secret-123&debug=1",
      })
    }).pipe(
      Effect.provide(
        fixedResponse(
          new ReadableStream({
            start(controller) {
              controller.error(systemError("ECONNRESET", "disconnected query-secret-123 header-secret-456"))
            },
          }),
          {},
        ),
      ),
    ),
  )

  it.effect("unwraps native transport failure causes", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* RequestExecutor.stream(executor, secretRequest).pipe(Stream.runDrain, Effect.flip)

      expectAIError(error)
      expect(error.message).toBe("ECONNRESET: socket closed")
      expect(error.reason.cause).toBeInstanceOf(TypeError)
      expect(error.reason).toMatchObject({
        _tag: "Transport",
        operation: "read",
        code: "ECONNRESET",
      })
    }).pipe(
      Effect.provide(
        fixedResponse(
          new ReadableStream({
            pull(controller) {
              controller.error(new TypeError("fetch failed", { cause: systemError("ECONNRESET", "socket closed") }))
            },
          }),
          {},
        ),
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
      expect(error.message).toBe("plugin rejected request")
      expect(error.reason.cause).toBeInstanceOf(Error)
      expect(error.reason.http).toBeUndefined()
    }).pipe(Effect.provide(dynamicResponse(() => Effect.die(new Error("unexpected HTTP request"))))),
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
      expect(error.message).toBe("ECONNRESET: proxy disconnected proxy-secret")
      expect(error.reason.http).toBeUndefined()
      expect(error.reason).toMatchObject({
        _tag: "Transport",
        url: "https://proxy.test/v1/chat?api_key=proxy-secret",
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
        fixedResponse('{"error":{"code":"context_length_exceeded","message":"prompt too long"}}', {
          status: 400,
        }),
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
      })
      expect(error.reason.http?.status).toBe(413)
    }).pipe(Effect.provide(fixedResponse("request too large", { status: 413 }))),
  )

  it.effect("classifies Anthropic request_too_large as context overflow", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectAIError(error)
      expect(error.reason).toMatchObject({
        _tag: "InvalidRequest",
        classification: "context-overflow",
      })
      expect(error.reason.http?.status).toBe(413)
    }).pipe(
      Effect.provide(
        fixedResponse('{"error":{"type":"request_too_large","message":"Request exceeds the maximum size"}}', {
          status: 413,
        }),
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
      expect(error.message).toBe("Provider request failed with HTTP 400")
    }).pipe(Effect.provide(fixedResponse("invalid parameter", { status: 400 }))),
  )

  it.effect("preserves structured provider messages from large error bodies", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectAIError(error)
      expect(error.reason).toMatchObject({ _tag: "InvalidRequest" })
      expect(error.message).toBe(largeProviderMessage)
      expect(error.reason.body).toContain(largeProviderMessage)
    }).pipe(
      Effect.provide(
        fixedResponse(
          JSON.stringify({
            model: "test-model",
            error: { type: "invalid_request", message: largeProviderMessage },
          }),
          { status: 400 },
        ),
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
      })
      expect(error.message).toBe("Provider request failed with HTTP 400")
    }).pipe(Effect.provide(fixedResponse('{"error":{"message":"  "}}', { status: 400 }))),
  )

  it.effect("classifies provider rate limits hidden behind HTTP 400", () =>
    Effect.gen(function* () {
      const classify = (body: string) =>
        Effect.gen(function* () {
          const executor = yield* RequestExecutor.Service
          const error = yield* executor.execute(request).pipe(Effect.flip)

          expectAIError(error)
          expect(error.reason).toMatchObject({ _tag: "RateLimit" })
        }).pipe(Effect.provide(fixedResponse(body, { status: 400 })))

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
        }).pipe(Effect.provide(fixedResponse(body, { status: 400 })))

      yield* classify('{"code":"resource_exhausted"}')
      yield* classify('{"code":"service_unavailable"}')
    }),
  )

  it.effect("returns complete diagnostics for rate limits", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectAIError(error)
      expect(error.reason).toMatchObject({
        _tag: "RateLimit",
        retryAfterMs: 0,
        rateLimit: { retryAfterMs: 0 },
        http: {
          url: "https://provider.test/v1/chat?api_key=secret&key=secret&debug=1",
          status: 429,
          headers: {
            "retry-after-ms": "0",
            "x-request-id": "req_123",
            "x-api-key": "secret",
          },
        },
      })
      expect(error.reason.body).toBe("rate limited")
    }).pipe(
      Effect.provide(
        fixedResponse("rate limited", {
          status: 429,
          headers: { "retry-after-ms": "0", "x-request-id": "req_123", "x-api-key": "secret" },
        }),
      ),
    ),
  )

  it.effect("preserves configured header names in diagnostics", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectAIError(error)
      expect(error.reason.http?.headers["x-safe"]).toBe("response-secret")
    }).pipe(
      Effect.provide(fixedResponse("bad", { status: 400, headers: { "x-safe": "response-secret" } })),
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
        fixedResponse("rate limited", {
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
  )

  it.effect("extracts Anthropic-style rate-limit diagnostics", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectAIError(error)
      expect(error.reason).toMatchObject({ _tag: "RateLimit" })
      expect(error.reason._tag === "RateLimit" ? error.reason.rateLimit : undefined).toEqual({
        retryAfterMs: 0,
        limit: { requests: "100", "input-tokens": "10000" },
        remaining: { requests: "12", "input-tokens": "9000" },
        reset: { requests: "2026-05-06T12:00:00Z", "input-tokens": "2026-05-06T12:00:10Z" },
      })
    }).pipe(
      Effect.provide(
        fixedResponse("rate limited", {
          status: 429,
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
  )

  it.effect("returns provider status failures without retrying", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const error = yield* Effect.gen(function* () {
        const executor = yield* RequestExecutor.Service
        return yield* executor.execute(request).pipe(Effect.flip)
      }).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const attempt = yield* Ref.getAndUpdate(attempts, (value) => value + 1)
              return attempt === 0
                ? input.respond("busy", { status: 503, headers: { "retry-after-ms": "0" } })
                : input.respond("ok", { status: 200 })
            }),
          ),
        ),
      )

      expectAIError(error)
      expect(error.reason).toMatchObject({ _tag: "ProviderInternal" })
      expect(error.reason.http?.status).toBe(503)
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
          expect(error.reason).toMatchObject({ _tag: "ProviderInternal" })
          expect(error.reason.http?.status).toBe(status)
        }).pipe(
          Effect.provide(
            fixedResponse("provider failure", {
              status,
              headers: { "retry-after-ms": "0" },
            }),
          ),
        )

      yield* failWith(504)
      yield* failWith(529)
    }),
  )

  it.effect("preserves large authentication error bodies", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const error = yield* Effect.gen(function* () {
        const executor = yield* RequestExecutor.Service
        return yield* executor.execute(request).pipe(Effect.flip)
      }).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const attempt = yield* Ref.getAndUpdate(attempts, (value) => value + 1)
              return attempt === 0
                ? input.respond("x".repeat(20_000), { status: 401 })
                : input.respond("should not retry", { status: 200 })
            }),
          ),
        ),
      )

      expectAIError(error)
      expect(error.reason).toMatchObject({ _tag: "Authentication" })
      expect(error.reason.body).toHaveLength(20_000)
      expect(yield* Ref.get(attempts)).toBe(1)
    }),
  )

  it.effect("preserves response body fields", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(request).pipe(Effect.flip)

      expectAIError(error)
      expect(error.reason.body).toBe('{"error":{"message":"bad","key":"body-secret","detail":"api_key=query-secret"}}')
    }).pipe(
      Effect.provide(
        fixedResponse('{"error":{"message":"bad","key":"body-secret","detail":"api_key=query-secret"}}', {
          status: 400,
        }),
      ),
    ),
  )

  it.effect("preserves echoed request values in response bodies", () =>
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const error = yield* executor.execute(secretRequest).pipe(Effect.flip)

      expectAIError(error)
      expect(error.reason.body).toBe("provider echoed query-secret-123 and authorization header-secret-456")
    }).pipe(
      Effect.provide(
        fixedResponse("provider echoed query-secret-123 and authorization header-secret-456", { status: 400 }),
      ),
    ),
  )

  it.effect("does not re-execute after a successful response reaches stream parsing", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const model = route.with({ endpoint: { baseURL: "https://api.openai.test/v1" } }).model({ id: "gpt-4o-mini" })
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
      expect(error.reason.body).toBe("not-json")
      expect(error.reason.cause).toBeDefined()
      expect(error.reason.http).toMatchObject({ status: 200, headers: { "content-type": "text/event-stream" } })
      expect(yield* Ref.get(attempts)).toBe(1)
    }),
  )
})

describe("WebSocket channel execution", () => {
  const model = configure({ baseURL: "https://api.openai.test/v1/", apiKey: "test" }).responses("gpt-4.1-mini")
  const request = LLM.request({ model, prompt: "Say hello." })
  const frames = [
    JSON.stringify({ type: "response.output_item.added", item: { type: "message", id: "msg_1" } }),
    JSON.stringify({ type: "response.output_text.delta", item_id: "msg_1", delta: "Hi" }),
    JSON.stringify({ type: "response.completed", response: { id: "resp_1" } }),
  ]

  it.effect("preserves close reasons and native event causes without fabricated HTTP metadata", () =>
    Effect.gen(function* () {
      class TestSocket extends EventTarget {
        readyState = globalThis.WebSocket.OPEN
        send() {}
        close() {}
      }
      const socket = new TestSocket()
      const connection = yield* WebSocketTransport.fromWebSocket(
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        socket as unknown as globalThis.WebSocket,
        { url: "wss://provider.test/responses", headers: Headers.empty },
      )
      const event = new CloseEvent("close", { code: 1011, reason: "upstream trace: req_close" })
      socket.dispatchEvent(event)
      const error = yield* connection.messages.pipe(Stream.runDrain, Effect.flip)

      expect(error.reason).toMatchObject({ _tag: "Transport", code: "1011", phase: "close" })
      expect(error.message).toBe("WebSocket closed with code 1011")
      expect(error.reason.body).toBe(event.reason)
      expect(error.reason.cause).toBe(event)
      expect(error.reason.http).toBeUndefined()
      yield* connection.close
    }),
  )

  it.effect("preserves opening event errors and native send exceptions", () =>
    Effect.gen(function* () {
      const cause = new Error("native send failed")
      class TestSocket extends EventTarget {
        readyState = globalThis.WebSocket.CONNECTING
        send() {
          throw cause
        }
        close() {}
      }
      const socket = new TestSocket()
      const open = WebSocketTransport.fromWebSocket(
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        socket as unknown as globalThis.WebSocket,
        { url: "wss://provider.test/responses", headers: Headers.empty },
      )
      const fiber = yield* open.pipe(Effect.flip, Effect.forkChild({ startImmediately: true }))
      const event = new ErrorEvent("error", { message: "handshake rejected", error: cause })
      socket.dispatchEvent(event)
      const error = yield* Fiber.join(fiber)
      expect(error.reason.cause).toBe(cause)
      expect(error.message).toContain("handshake rejected")
      expect(error.reason.http).toBeUndefined()

      socket.readyState = globalThis.WebSocket.OPEN
      const connection = yield* open
      const sent = yield* connection.sendText("create").pipe(Effect.flip)
      expect(sent.reason.cause).toBe(cause)
      expect(sent.message).toBe(cause.message)
      yield* connection.close
    }),
  )

  it.effect("preserves raw driver failures and known upgrade metadata", () =>
    Effect.gen(function* () {
      const cause = new Error("driver validation failed")
      const frame = '{ "error": "failed", "trace": "original" }'
      const http = new HttpContext({
        url: "https://provider.test/responses",
        status: 101,
        headers: { upgrade: "websocket" },
      })
      const executor = WebSocketTransport.makeDirect({
        open: () =>
          Effect.succeed({
            http,
            sendText: () => Effect.void,
            messages: Stream.make(frame),
            close: Effect.void,
          }),
      })
      const execution = yield* executor.execute({
        id: "exchange_error",
        connect: { url: "wss://provider.test/responses", headers: Headers.empty },
        fallback: () => Stream.empty,
        driver: {
          create: () => Effect.succeed({ message: "create", mode: "full" }),
          observe: () =>
            Effect.succeed({
              type: "provider-failure",
              error: new AIError({
                reason: new InvalidProviderOutputError({
                  message: "Driver failed",
                  cause,
                  body: "narrowed",
                }),
              }),
            }),
        },
      })
      const error = yield* execution.frames.pipe(Stream.runDrain, Effect.flip)

      expect(error.message).toBe("Driver failed")
      expect(error.reason.body).toBe(frame)
      expect(error.reason.cause).toBe(cause)
      expect(error.reason.http).toBe(http)
      expect(execution.http).toBe(http)
    }),
  )

  it.effect("retains diagnostic fields when annotating transport delivery", () =>
    Effect.gen(function* () {
      const cause = new Error("connection closed")
      const executor = WebSocketTransport.makeDirect({
        open: () =>
          Effect.succeed({
            sendText: () => Effect.void,
            messages: Stream.fail(
              new AIError({
                reason: new TransportError({
                  message: "Socket closed",
                  transport: "websocket",
                  operation: "read",
                  phase: "close",
                  recovery: "retry-full",
                  body: "server close detail",
                  cause,
                }),
              }),
            ),
            close: Effect.void,
          }),
      })
      const execution = yield* executor.execute({
        id: "exchange_closed",
        connect: { url: "wss://provider.test/responses", headers: Headers.empty },
        fallback: () => Stream.empty,
        driver: {
          create: () => Effect.succeed({ message: "create", mode: "full" }),
          observe: (_create, frame) => Effect.succeed({ type: "frame", frame }),
        },
      })
      const error = yield* execution.frames.pipe(Stream.runDrain, Effect.flip)

      expect(error.message).toBe("Socket closed")
      expect(error.reason.body).toBe("server close detail")
      expect(error.reason.cause).toBe(cause)
      expect(error.reason).toMatchObject({ phase: "close", delivery: "ambiguous", recovery: "retry-full" })
      expect(error.reason.http).toBeUndefined()
    }),
  )

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
