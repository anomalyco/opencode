import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Redacted, Stream } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { ai, AIClient, type AIError, Media } from "../src/effect.js"
import { Realtime } from "../src/experimental.js"
import { Auth, LLMClient, mergeTransport, RequestExecutor } from "../src/route.js"
import { AnthropicMessages } from "../src/protocols/anthropic-messages.js"
import { AssemblyAI, BytePlus, OpenAI } from "../src/providers.js"
import { dynamicResponse, handlerLayer } from "./lib/http.js"
import { deltaChunk, finishChunk } from "./lib/openai-chunks.js"
import { sseEvents, sseNamedEvent, sseRaw } from "./lib/sse.js"
import { it } from "./lib/effect.js"

const openai = OpenAI.configure({ baseURL: "https://api.openai.test/v1/", apiKey: "test" })
const model = openai.chat("gpt-4.1-mini")
const video = BytePlus.configure({ baseURL: "https://api.byteplus.test/v3", apiKey: "test" }).video("seedance-1-5")
const SSE = { headers: { "content-type": "text/event-stream" } }

const silentServer = dynamicResponse(() => Effect.never)
const silentClients = AIClient.layerWith(RequestExecutor.layer.pipe(Layer.provide(handlerLayer(() => Effect.never))))

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

const anthropic = AnthropicMessages.route
  .with({ endpoint: { baseURL: "https://api.anthropic.test/v1/" }, auth: Auth.header("x-api-key", "test") })
  .model({ id: "claude-sonnet-4-5" })

// Streams only what the test pushes, so it controls what arrives between clock adjustments.
const pushedServer = Effect.gen(function* () {
  const opened = yield* Deferred.make<ReadableStreamDefaultController<Uint8Array>>()
  const encoder = new TextEncoder()
  const layer = dynamicResponse((input) =>
    Effect.sync(() =>
      input.respond(
        new ReadableStream<Uint8Array>({
          start(controller) {
            Deferred.doneUnsafe(opened, Effect.succeed(controller))
          },
        }),
        SSE,
      ),
    ),
  )
  const push = (...events: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const controller = yield* Deferred.await(opened)
      controller.enqueue(encoder.encode(sseRaw(...events)))
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 0)))
    })
  return { layer, push, close: Deferred.await(opened).pipe(Effect.map((controller) => controller.close())) }
})

const textStart = [
  sseNamedEvent("message_start", { type: "message_start", message: { usage: { input_tokens: 5 } } }),
  sseNamedEvent("content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  }),
]

const textDelta = (text: string) =>
  sseNamedEvent("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })

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

  it.effect("fails when an error response's body stalls for fifteen minutes", () =>
    Effect.gen(function* () {
      const stalled = yield* Deferred.make<void>()
      const layer = dynamicResponse((input) =>
        Effect.sync(() =>
          input.respond(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"error":'))
              },
              pull: () => Deferred.doneUnsafe(stalled, Effect.void) && new Promise<void>(() => {}),
            }),
            { status: 503 },
          ),
        ),
      )
      const fiber = yield* LLMClient.generate(ai.request({ model, prompt: "Hello" })).pipe(
        Effect.provide(layer),
        Effect.flip,
        Effect.forkChild({ startImmediately: true }),
      )
      yield* Deferred.await(stalled)
      yield* Effect.yieldNow
      yield* TestClock.adjust("15 minutes")
      const error = yield* Fiber.join(fiber)

      expect(error.message).toContain("HTTP 503")
    }),
  )

  it.effect("fails when only keepalives and pings arrive for fifteen minutes", () =>
    Effect.gen(function* () {
      const server = yield* pushedServer
      const fiber = yield* LLMClient.generate(ai.request({ model: anthropic, prompt: "Hello" })).pipe(
        Effect.provide(server.layer),
        Effect.flip,
        Effect.forkChild({ startImmediately: true }),
      )
      yield* server.push(...textStart)
      yield* TestClock.adjust("10 minutes")
      yield* server.push(": keep-alive", sseNamedEvent("ping", { type: "ping" }))
      yield* TestClock.adjust("10 minutes")
      const error = yield* Fiber.join(fiber)

      expect(error.reason).toMatchObject({ _tag: "Transport", transport: "http", operation: "read", code: "Timeout" })
    }),
  )

  it.effect("keeps streaming while model output arrives inside each chunk window", () =>
    Effect.gen(function* () {
      const server = yield* pushedServer
      const fiber = yield* LLMClient.generate(ai.request({ model: anthropic, prompt: "Hello" })).pipe(
        Effect.provide(server.layer),
        Effect.forkChild({ startImmediately: true }),
      )
      yield* server.push(...textStart)
      for (const text of ["a", "b", "c"]) {
        yield* TestClock.adjust("10 minutes")
        yield* server.push(textDelta(text))
      }
      yield* server.push(
        sseNamedEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
        sseNamedEvent("message_delta", {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 3 },
        }),
        sseNamedEvent("message_stop", { type: "message_stop" }),
      )
      yield* server.close
      const response = yield* Fiber.join(fiber)

      expect(response.text).toBe("abc")
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

  it.effect("applies provider-configured timeouts to every API method", () =>
    Effect.gen(function* () {
      const timeout = { headers: 1_000 }
      const timedOpenAI = OpenAI.configure({ baseURL: "https://api.openai.test/v1/", apiKey: "test", timeout })
      const timedVideo = BytePlus.configure({ baseURL: "https://api.byteplus.test/v3", apiKey: "test", timeout }).video(
        "seedance-1-5",
      )
      const timedTranscription = AssemblyAI.configure({
        baseURL: "https://assemblyai.test",
        apiKey: "test",
        timeout,
      }).transcription("universal-2")
      const audio = Media.bytes(Uint8Array.from([0x49, 0x44, 0x33, 1, 2, 3]), "audio/mpeg")
      const image = timedOpenAI.image("gpt-image-2")
      const chat = { model: timedOpenAI.chat("gpt-4.1-mini"), prompt: "Hello" }
      const drain = <A, E, R>(stream: Stream.Stream<A, E, R>) => Stream.runDrain(stream)

      // Every callable method on `ai` must be listed here (as a provider call or a local helper), so a new method
      // cannot ship without timeout coverage.
      const calls: Record<string, Effect.Effect<unknown, AIError, AIClient.Services>> = {
        generate: ai.generate(chat),
        stream: drain(ai.stream(chat)),
        loop: drain(ai.loop(chat)),
        compact: ai.compact(ai.request({ model: timedOpenAI.responses("gpt-5"), prompt: "Hello" })),
        "image.generate": ai.image.generate({ model: image, prompt: "A kite" }),
        "image.stream": drain(ai.image.stream({ model: image, prompt: "A kite" })),
        "image.start": ai.image.start({ model: image, prompt: "A kite" }),
        "image.status": ai.image.status(image, "job"),
        "image.result": ai.image.result(image, "job"),
        "image.cancel": ai.image.cancel(image, "job"),
        "decision.generate": ai.decision.generate({
          model: timedOpenAI.decision("gpt-6-luna"),
          input: "hello",
          questions: [{ name: "greeting", type: "choice", instructions: "Greeting?", choices: [{ value: true }] }],
        }),
        "embedding.generate": ai.embedding.generate({
          model: timedOpenAI.embedding("text-embedding-3-small"),
          values: ["hello"],
        }),
        "video.start": ai.video.start({ model: timedVideo, prompt: "A kite" }),
        "video.status": ai.video.status(timedVideo, "job"),
        "video.result": ai.video.result(timedVideo, "job"),
        "video.cancel": ai.video.cancel(timedVideo, "job"),
        "experimental.speech.generate": ai.experimental.speech.generate({
          model: timedOpenAI.speech("gpt-4o-mini-tts"),
          text: "Hello",
        }),
        "experimental.speech.stream": drain(
          ai.experimental.speech.stream({ model: timedOpenAI.speech("gpt-4o-mini-tts"), text: "Hello" }),
        ),
        "experimental.transcription.generate": ai.experimental.transcription.generate({
          model: timedTranscription,
          audio,
        }),
        "experimental.transcription.stream": drain(
          ai.experimental.transcription.stream({ model: timedTranscription, audio }),
        ),
        "experimental.transcription.start": ai.experimental.transcription.start({ model: timedTranscription, audio }),
        "experimental.transcription.resume": ai.experimental.transcription.resume(timedTranscription, {
          transcriptID: "tr_1",
        }),
      }
      const local = [
        "request",
        "collect",
        "canCompact",
        "image.request",
        "decision.request",
        "embedding.request",
        "video.request",
        "experimental.speech.request",
        "experimental.transcription.request",
      ]
      const listMethods = (value: object, prefix = ""): Array<string> =>
        Object.entries(value).flatMap(([key, entry]) => {
          if (typeof entry === "function") return [`${prefix}${key}`]
          if (typeof entry === "object" && entry !== null) return listMethods(entry, `${prefix}${key}.`)
          return []
        })
      expect(listMethods(ai).toSorted()).toEqual([...Object.keys(calls), ...local].toSorted())

      const check = (effect: Effect.Effect<unknown, AIError, AIClient.Services>) =>
        Effect.gen(function* () {
          const fiber = yield* effect.pipe(
            Effect.provide(silentClients),
            Effect.flip,
            Effect.forkChild({ startImmediately: true }),
          )
          // Retried status/result reads make up to 9 attempts with exponential backoff (< 4 min total, still under
          // the 5 min default header timeout), so finishing here proves the 1 s configured timeout applied.
          for (let i = 0; i < 240 && fiber.pollUnsafe() === undefined; i++) yield* TestClock.adjust("1 second")
          const error = yield* Fiber.join(fiber)
          if (error.reason._tag === "UnsupportedOperation") return
          expect(error.reason).toMatchObject({ _tag: "Transport", operation: "request", code: "Timeout" })
        })

      for (const effect of Object.values(calls)) yield* check(effect)
      yield* check(
        Realtime.connect({
          model: "gpt-realtime",
          apiKey: Redacted.make("test"),
          transport: { type: "websocket" },
          timeout,
        }),
      )
    }),
  )
})
