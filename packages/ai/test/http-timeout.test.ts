import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { HttpOptions, LLM, mergeHttpOptions } from "../src/index.js"
import { LLMClient } from "../src/route.js"
import { configure } from "../src/providers/openai.js"
import { dynamicResponse } from "./lib/http.js"
import { deltaChunk, finishChunk } from "./lib/openai-chunks.js"
import { sseEvents } from "./lib/sse.js"
import { it } from "./lib/effect.js"

const model = configure({ baseURL: "https://api.openai.test/v1/", apiKey: "test" }).chat("gpt-4.1-mini")
const body = sseEvents(deltaChunk({ role: "assistant", content: "Hi" }), finishChunk("stop"))
const SSE = { headers: { "content-type": "text/event-stream" } }

// Never produces headers; the header timer is the only way out.
const silentServer = dynamicResponse(() => Effect.never)

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
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(deltaChunk({ content: "Hi" }))}\n\n`))
          },
          async pull(controller) {
            Deferred.doneUnsafe(stalled, Effect.void)
            await released
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(finishChunk("stop"))}\n\ndata: [DONE]\n\n`))
            controller.close()
          },
        }),
        SSE,
      ),
    ),
  )
  return { layer, stalled, resume: () => resume() }
})

const slowHeadersServer = dynamicResponse((input) =>
  Effect.sleep("10 minutes").pipe(Effect.as(input.respond(body, SSE))),
)

describe("HTTP transport timeouts", () => {
  it.effect("fails when response headers take longer than five minutes", () =>
    Effect.gen(function* () {
      const fiber = yield* LLMClient.generate(LLM.request({ model, prompt: "Hello" })).pipe(
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
      expect(error.reason.message).toContain("response headers")
    }),
  )

  it.effect("fails when the response body stalls for five minutes", () =>
    Effect.gen(function* () {
      const server = yield* stalledServer
      const fiber = yield* LLMClient.generate(LLM.request({ model, prompt: "Hello" })).pipe(
        Effect.provide(server.layer),
        Effect.flip,
        Effect.forkChild({ startImmediately: true }),
      )
      yield* Deferred.await(server.stalled)
      yield* Effect.yieldNow
      yield* TestClock.adjust("5 minutes")
      const error = yield* Fiber.join(fiber)

      expect(error.reason).toMatchObject({ _tag: "Transport", transport: "http", operation: "read", code: "Timeout" })
      expect(error.reason.http).toMatchObject({ status: 200 })
    }),
  )

  it.effect("applies a configured header timeout", () =>
    Effect.gen(function* () {
      const fiber = yield* LLMClient.generate(
        LLM.request({ model, prompt: "Hello", http: { headerTimeout: 1_000 } }),
      ).pipe(Effect.provide(silentServer), Effect.flip, Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("1 second")
      const error = yield* Fiber.join(fiber)

      expect(error.reason).toMatchObject({ _tag: "Transport", operation: "request", code: "Timeout" })
    }),
  )

  it.effect("disables the header timeout with false", () =>
    Effect.gen(function* () {
      const fiber = yield* LLMClient.generate(
        LLM.request({ model, prompt: "Hello", http: { headerTimeout: false } }),
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
        LLM.request({ model, prompt: "Hello", http: { chunkTimeout: false } }),
      ).pipe(Effect.provide(server.layer), Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(server.stalled)
      yield* Effect.yieldNow
      yield* TestClock.adjust("10 minutes")
      server.resume()
      const response = yield* Fiber.join(fiber)

      expect(response.text).toBe("Hi")
    }),
  )

  it.effect("merges timeouts with later values winning", () =>
    Effect.sync(() => {
      const merged = mergeHttpOptions(
        new HttpOptions({ headerTimeout: 1_000, chunkTimeout: 2_000 }),
        new HttpOptions({ headers: { a: "b" } }),
        new HttpOptions({ chunkTimeout: false }),
      )

      expect(merged).toMatchObject({ headers: { a: "b" }, headerTimeout: 1_000, chunkTimeout: false })
      expect(mergeHttpOptions(new HttpOptions({}), undefined)).toBeUndefined()
      expect(mergeHttpOptions(new HttpOptions({ headerTimeout: false }))?.headerTimeout).toBe(false)
    }),
  )
})
