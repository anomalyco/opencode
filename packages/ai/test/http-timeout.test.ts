import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Stream } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { ai, HttpOptions, type LLMRequest } from "../src/effect.js"
import { OpenAIChat } from "../src/protocols/openai-chat.js"
import { Anthropic } from "../src/providers.js"
import { Framing, LLMClient, mergeHttpOptions, Route } from "../src/route.js"
import { configure } from "../src/providers/openai.js"
import { dynamicResponse } from "./lib/http.js"
import { deltaChunk, finishChunk } from "./lib/openai-chunks.js"
import { sseEvents, sseRaw } from "./lib/sse.js"
import { it } from "./lib/effect.js"

const model = configure({ baseURL: "https://api.openai.test/v1/", apiKey: "test" }).chat("gpt-4.1-mini")
const SSE = { headers: { "content-type": "text/event-stream" } }

const silentServer = dynamicResponse(() => Effect.never)

const slowHeadersServer = dynamicResponse((input) =>
  Effect.sleep("10 minutes").pipe(
    Effect.as(input.respond(sseEvents(deltaChunk({ role: "assistant", content: "Hi" }), finishChunk("stop")), SSE)),
  ),
)

// Sends one chunk, then stalls until `resume` releases the rest of the body.
const stalledServer = Effect.gen(function* () {
  const stalled = yield* Deferred.make<void>()
  let resume = () => {}
  const released = new Promise<void>((resolve) => {
    resume = resolve
  })
  const encoder = new TextEncoder()
  const layer = dynamicResponse((input) =>
    Effect.sync(() =>
      input.respond(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(sseRaw(`data: ${JSON.stringify(deltaChunk({ content: "Hi" }))}`)))
          },
          async pull(controller) {
            Deferred.doneUnsafe(stalled, Effect.void)
            await released
            controller.enqueue(encoder.encode(sseEvents(finishChunk("stop"))))
            controller.close()
          },
        }),
        SSE,
      ),
    ),
  )
  return { layer, stalled, resume: () => resume() }
})

// Sends `first`, then `heartbeat` once a minute on the test clock. With `last`, sends it after five heartbeats and
// ends the body; otherwise the body never ends.
const heartbeatServer = (input: { first: string; heartbeat: string; last?: string; headers?: HeadersInit }) =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>()
    let sent = 0
    const heartbeats = Stream.tick("1 minute").pipe(
      Stream.drop(1),
      Stream.map(() => {
        sent++
        return input.heartbeat
      }),
    )
    const layer = dynamicResponse((request) =>
      Stream.make(input.first).pipe(
        Stream.concat(
          input.last === undefined ? heartbeats : heartbeats.pipe(Stream.take(5), Stream.concat(Stream.make(input.last))),
        ),
        Stream.encodeText,
        Stream.toReadableStreamEffect(),
        Effect.tap(() => Deferred.succeed(started, undefined)),
        Effect.map((body) => request.respond(body, { headers: input.headers ?? SSE.headers })),
      ),
    )
    // Starts `request` and lets five minutes of test clock time pass, one minute at a time, so the response body's
    // promise hops run between steps.
    const run = (request: LLMRequest) =>
      Effect.gen(function* () {
        const fiber = yield* LLMClient.generate(request).pipe(
          Effect.provide(layer),
          Effect.result,
          Effect.forkChild({ startImmediately: true }),
        )
        yield* Deferred.await(started)
        yield* TestClock.withLive(Effect.sleep("1 millis"))
        yield* Effect.forEach(
          Array.from({ length: 5 }),
          () => TestClock.adjust("1 minute").pipe(Effect.andThen(TestClock.withLive(Effect.sleep("1 millis")))),
          { discard: true },
        )
        return fiber
      })
    return { run, sent: () => sent }
  })

const openAIHeartbeat = (heartbeat: string) =>
  Effect.gen(function* () {
    const server = yield* heartbeatServer({
      first: sseRaw(`data: ${JSON.stringify(deltaChunk({ content: "Hi" }))}`),
      heartbeat,
    })
    const fiber = yield* server.run(ai.request({ model, prompt: "Hello", http: { chunkTimeout: 120_000 } }))
    return { fiber, sent: server.sent }
  })

describe("HTTP transport timeouts", () => {
  it.effect("fails when response headers take longer than five minutes", () =>
    Effect.gen(function* () {
      const fiber = yield* LLMClient.generate(ai.request({ model, prompt: "Hello" })).pipe(
        Effect.provide(silentServer),
        Effect.flip,
        Effect.forkChild({ startImmediately: true }),
      )
      yield* TestClock.adjust("5 minutes")
      const error = yield* Fiber.join(fiber)

      expect(error.reason).toMatchObject({
        _tag: "Transport",
        transport: "http",
        operation: "request",
        code: "Timeout",
      })
    }),
  )

  it.effect("fails when the response body stalls for fifteen minutes", () =>
    Effect.gen(function* () {
      const server = yield* stalledServer
      const fiber = yield* LLMClient.generate(ai.request({ model, prompt: "Hello" })).pipe(
        Effect.provide(server.layer),
        Effect.flip,
        Effect.forkChild({ startImmediately: true }),
      )
      yield* Deferred.await(server.stalled)
      yield* Effect.yieldNow
      yield* TestClock.adjust("15 minutes")
      const error = yield* Fiber.join(fiber)

      expect(error.reason).toMatchObject({ _tag: "Transport", transport: "http", operation: "read", code: "Timeout" })
      expect(error.reason.http).toMatchObject({ status: 200 })
    }),
  )

  // DeepSeek sends `: keep-alive` while a request is queued, OpenRouter `: OPENROUTER PROCESSING`, and Vertex
  // partner models `data: : keepalive`. Framing drops all three, so none of them is provider progress.
  for (const heartbeat of [": keep-alive\n\n", ": OPENROUTER PROCESSING\n\n", "data: : keepalive\n\n"]) {
    it.effect(`times out when the body only sends ${JSON.stringify(heartbeat.trim())}`, () =>
      Effect.gen(function* () {
        const request = yield* openAIHeartbeat(heartbeat)
        const exit = request.fiber.pollUnsafe()
        yield* Fiber.interrupt(request.fiber)

        // A heartbeat landed inside the two-minute window; the server stops once the client stops reading.
        expect(request.sent()).toBeGreaterThan(0)
        expect(exit).toMatchObject({
          _tag: "Success",
          value: { _tag: "Failure", failure: { reason: { _tag: "Transport", operation: "read", code: "Timeout" } } },
        })
      }),
    )
  }

  it.effect("keeps an SSE stream open while data events arrive", () =>
    Effect.gen(function* () {
      const request = yield* openAIHeartbeat(`data: ${JSON.stringify(deltaChunk({ content: "" }))}\n\n`)
      const exit = request.fiber.pollUnsafe()
      yield* Fiber.interrupt(request.fiber)

      expect(request.sent()).toBe(5)
      expect(exit).toBeUndefined()
    }),
  )

  it.effect("keeps an Anthropic stream open while ping events arrive", () =>
    Effect.gen(function* () {
      const server = yield* heartbeatServer({ first: "", heartbeat: 'event: ping\ndata: {"type":"ping"}\n\n' })
      const fiber = yield* server.run(
        ai.request({
          model: Anthropic.configure({ baseURL: "https://api.anthropic.test", apiKey: "test" }).model("claude"),
          prompt: "Hello",
          http: { chunkTimeout: 120_000 },
        }),
      )
      const exit = fiber.pollUnsafe()
      yield* Fiber.interrupt(fiber)

      expect(server.sent()).toBe(5)
      expect(exit).toBeUndefined()
    }),
  )

  it.effect("keeps timing bytes for a framing that emits one frame when the body ends", () =>
    Effect.gen(function* () {
      // The whole body is one OpenAI chunk; a space a minute keeps the bytes flowing for longer than the timeout.
      const server = yield* heartbeatServer({
        first: `{"id":"chatcmpl_fixture","choices":[{"delta":`,
        heartbeat: " ",
        last: `{"content":"Hi"},"finish_reason":"stop"}]}`,
        headers: { "content-type": "application/json" },
      })
      const route = Route.make({
        id: "openai-chat-document",
        provider: "openai",
        protocol: OpenAIChat.protocol,
        endpoint: OpenAIChat.route.endpoint,
        framing: Framing.document,
      })
      const fiber = yield* server.run(
        ai.request({ model: route.model({ id: "gpt-4.1-mini" }), prompt: "Hello", http: { chunkTimeout: 120_000 } }),
      )
      const result = yield* Fiber.join(fiber)

      expect(server.sent()).toBe(5)
      expect(result).toMatchObject({ _tag: "Success", success: { text: "Hi" } })
    }),
  )

  it.effect("applies a configured header timeout", () =>
    Effect.gen(function* () {
      const fiber = yield* LLMClient.generate(
        ai.request({ model, prompt: "Hello", http: { headerTimeout: 1_000 } }),
      ).pipe(Effect.provide(silentServer), Effect.flip, Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("1 second")
      const error = yield* Fiber.join(fiber)

      expect(error.reason).toMatchObject({ _tag: "Transport", operation: "request", code: "Timeout" })
    }),
  )

  it.effect("disables the header timeout with false", () =>
    Effect.gen(function* () {
      const fiber = yield* LLMClient.generate(
        ai.request({ model, prompt: "Hello", http: { headerTimeout: false } }),
      ).pipe(Effect.provide(slowHeadersServer), Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("10 minutes")
      const response = yield* Fiber.join(fiber)

      expect(response.text).toBe("Hi")
    }),
  )

  it.effect("disables the chunk timeout with false", () =>
    Effect.gen(function* () {
      const server = yield* stalledServer
      const fiber = yield* LLMClient.generate(
        ai.request({ model, prompt: "Hello", http: { chunkTimeout: false } }),
      ).pipe(Effect.provide(server.layer), Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(server.stalled)
      yield* Effect.yieldNow
      yield* TestClock.adjust("10 minutes")
      server.resume()
      const response = yield* Fiber.join(fiber)

      expect(response.text).toBe("Hi")
    }),
  )

  it.effect("applies a whole-request timeout while the body is still streaming", () =>
    Effect.gen(function* () {
      const server = yield* stalledServer
      const fiber = yield* LLMClient.generate(
        ai.request({ model, prompt: "Hello", http: { timeout: 60_000, chunkTimeout: false } }),
      ).pipe(Effect.provide(server.layer), Effect.flip, Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(server.stalled)
      yield* Effect.yieldNow
      yield* TestClock.adjust("1 minute")
      const error = yield* Fiber.join(fiber)

      expect(error.reason).toMatchObject({ _tag: "Transport", operation: "read", code: "Timeout" })
    }),
  )

  it.effect("bounds the header wait by a shorter whole-request timeout", () =>
    Effect.gen(function* () {
      const fiber = yield* LLMClient.generate(
        ai.request({ model, prompt: "Hello", http: { timeout: 1_000, headerTimeout: false } }),
      ).pipe(Effect.provide(silentServer), Effect.flip, Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("1 second")
      const error = yield* Fiber.join(fiber)

      expect(error.reason).toMatchObject({ _tag: "Transport", operation: "request", code: "Timeout" })
    }),
  )

  it.effect("merges timeouts with later values winning", () =>
    Effect.sync(() => {
      const merged = mergeHttpOptions(
        new HttpOptions({ timeout: 5_000, headerTimeout: 1_000, chunkTimeout: 2_000 }),
        new HttpOptions({ headers: { a: "b" } }),
        new HttpOptions({ chunkTimeout: false }),
      )

      expect(merged).toMatchObject({ headers: { a: "b" }, timeout: 5_000, headerTimeout: 1_000, chunkTimeout: false })
      expect(mergeHttpOptions(new HttpOptions({}), undefined)).toBeUndefined()
    }),
  )
})
