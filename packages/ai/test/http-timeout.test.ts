import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Stream } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { ai, Media, VideoClient } from "../src/effect.js"
import { LLMClient, mergeTransport } from "../src/route.js"
import { configure } from "../src/providers/openai.js"
import { XAI } from "../src/providers.js"
import { dynamicResponse } from "./lib/http.js"
import { deltaChunk, finishChunk } from "./lib/openai-chunks.js"
import { sseEvents, sseRaw } from "./lib/sse.js"
import { it } from "./lib/effect.js"

const openai = configure({ baseURL: "https://api.openai.test/v1/", apiKey: "test" })
const model = openai.chat("gpt-4.1-mini")
const video = XAI.configure({ baseURL: "https://api.xai.test/v1", apiKey: "test" }).video("grok-imagine-video-1.5")
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

  it.effect("applies a configured header timeout", () =>
    Effect.gen(function* () {
      const fiber = yield* LLMClient.generate(ai.request({ model, prompt: "Hello", timeout: { headers: 1_000 } })).pipe(
        Effect.provide(silentServer),
        Effect.flip,
        Effect.forkChild({ startImmediately: true }),
      )
      yield* TestClock.adjust("1 second")
      const error = yield* Fiber.join(fiber)

      expect(error.reason).toMatchObject({ _tag: "Transport", operation: "request", code: "Timeout" })
    }),
  )

  it.effect("disables the header timeout with false", () =>
    Effect.gen(function* () {
      const fiber = yield* LLMClient.generate(ai.request({ model, prompt: "Hello", timeout: { headers: false } })).pipe(
        Effect.provide(slowHeadersServer),
        Effect.forkChild({ startImmediately: true }),
      )
      yield* TestClock.adjust("10 minutes")
      const response = yield* Fiber.join(fiber)

      expect(response.text).toBe("Hi")
    }),
  )

  it.effect("disables the chunk timeout with false", () =>
    Effect.gen(function* () {
      const server = yield* stalledServer
      const fiber = yield* LLMClient.generate(ai.request({ model, prompt: "Hello", timeout: { chunk: false } })).pipe(
        Effect.provide(server.layer),
        Effect.forkChild({ startImmediately: true }),
      )
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
        ai.request({ model, prompt: "Hello", timeout: { total: 60_000, chunk: false } }),
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
        ai.request({ model, prompt: "Hello", timeout: { total: 1_000, headers: false } }),
      ).pipe(Effect.provide(silentServer), Effect.flip, Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("1 second")
      const error = yield* Fiber.join(fiber)

      expect(error.reason).toMatchObject({ _tag: "Transport", operation: "request", code: "Timeout" })
    }),
  )

  it.effect("merges timeouts with later values winning", () =>
    Effect.sync(() => {
      const merged = mergeTransport(
        { timeout: { total: 5_000, headers: 1_000, chunk: 2_000 } },
        { headers: { a: "b" } },
        { timeout: { chunk: false } },
        { timeout: 3_000 },
      )

      expect(merged).toMatchObject({ headers: { a: "b" }, timeout: { total: 3_000, headers: 1_000, chunk: false } })
      expect(mergeTransport({}, undefined)).toEqual({})
    }),
  )

  it.effect("applies default and configured timeouts to media routes", () =>
    Effect.gen(function* () {
      const videoSilent = VideoClient.layer.pipe(Layer.provideMerge(silentServer))

      const defaultFiber = yield* ai.video
        .start({ model: video, prompt: "A kite" })
        .pipe(Effect.provide(videoSilent), Effect.flip, Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("5 minutes")
      const defaultError = yield* Fiber.join(defaultFiber)
      expect(defaultError.reason).toMatchObject({ _tag: "Transport", operation: "request", code: "Timeout" })

      const customFiber = yield* ai.video
        .start({ model: video, prompt: "A kite", timeout: { headers: 1_000 } })
        .pipe(Effect.provide(videoSilent), Effect.flip, Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("1 second")
      const customError = yield* Fiber.join(customFiber)
      expect(customError.reason).toMatchObject({ _tag: "Transport", operation: "request", code: "Timeout" })

      const server = yield* stalledServer
      const bodyFiber = yield* ai.video
        .start({ model: video, prompt: "A kite" })
        .pipe(
          Effect.provide(VideoClient.layer.pipe(Layer.provideMerge(server.layer))),
          Effect.flip,
          Effect.forkChild({ startImmediately: true }),
        )
      yield* Deferred.await(server.stalled)
      yield* Effect.yieldNow
      yield* TestClock.adjust("15 minutes")
      const bodyError = yield* Fiber.join(bodyFiber)
      expect(bodyError.reason).toMatchObject({ _tag: "Transport", operation: "read", code: "Timeout" })
      expect(bodyError.reason.http).toMatchObject({ status: 200 })
    }),
  )

  it.effect("applies default timeouts to media URL downloads", () =>
    Effect.gen(function* () {
      const headerFiber = yield* Media.url("https://cdn.example.test/clip.mp4")
        .bytes()
        .pipe(Effect.provide(silentServer), Effect.flip, Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("5 minutes")
      const headerError = yield* Fiber.join(headerFiber)
      expect(headerError.reason).toMatchObject({ _tag: "Transport", operation: "request", code: "Timeout" })

      const server = yield* stalledServer
      const streamFiber = yield* Media.url("https://cdn.example.test/clip.mp4")
        .stream()
        .pipe(Stream.runDrain, Effect.provide(server.layer), Effect.flip, Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(server.stalled)
      yield* Effect.yieldNow
      yield* TestClock.adjust("15 minutes")
      const streamError = yield* Fiber.join(streamFiber)
      expect(streamError.reason).toMatchObject({ _tag: "Transport", operation: "read", code: "Timeout" })
      expect(streamError.reason.http).toMatchObject({ status: 200 })
    }),
  )

  it.effect("applies request timeout to responses compaction", () =>
    Effect.gen(function* () {
      const fiber = yield* ai
        .compact(ai.request({ model: openai.responses("gpt-5"), prompt: "Hello", timeout: { headers: 1_000 } }))
        .pipe(Effect.provide(silentServer), Effect.flip, Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("1 second")
      const error = yield* Fiber.join(fiber)
      expect(error.reason).toMatchObject({ _tag: "Transport", operation: "request", code: "Timeout" })
    }),
  )
})
