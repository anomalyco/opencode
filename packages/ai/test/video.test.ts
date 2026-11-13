import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer, Stream } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { Media, type GenerationEvent } from "../src/effect.js"
import { Video, VideoClient, type VideoEvent } from "../src/experimental.js"
import { XAI } from "../src/providers.js"
import { it } from "./lib/effect.js"
import { dynamicResponse, json, observe, settle, type Call, type HandlerInput } from "./lib/http.js"

const layer = (handler: Parameters<typeof dynamicResponse>[0]) =>
  VideoClient.layer.pipe(Layer.provideMerge(dynamicResponse(handler)))

// ---------------------------------------------------------------------------
// xAI
// ---------------------------------------------------------------------------

describe("Video / xAI", () => {
  const xai = XAI.configure({ apiKey: "test", baseURL: "https://xai.test/v1" })
  const model = xai.video("grok-imagine-video-1.5")

  it.effect("submits a generation, reports pending progress, and returns the temporary URL", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const events: Array<GenerationEvent> = []
      const program = Effect.gen(function* () {
        const generation = yield* Video.start({
          model,
          prompt: "Make the water crash down",
          frames: {
            first: Media.fromDataUrl("data:image/png;base64,AQID"),
            last: Media.url("https://example.test/last.png"),
          },
          references: [Media.ref("xai", "file_1")],
          durationSeconds: 10,
          aspect: "16:9",
          resolution: "720p",
          audio: false,
          providerOptions: { reference_audios: [{ voice_id: "eve" }], future_option: true },
          headers: { "x-request": "yes" },
          http: { query: { trace: "1" } },
        })
        expect(generation.token).toEqual({ requestID: "req_1" })
        events.push(...(yield* generation.events({ poll: { interval: "1 second" } }).pipe(Stream.runCollect)))
        return yield* generation.await()
      })
      const response = yield* settle(program, 2).pipe(
        Effect.provide(
          layer((input) =>
            Effect.gen(function* () {
              const { call, nth } = yield* observe(calls, input)
              expect(call.headers.get("authorization")).toBe("Bearer test")
              // The request's own `http` overlay follows the generation into every poll started from it.
              expect(call.headers.get("x-request")).toBe("yes")
              if (call.method === "POST") {
                expect(call.url).toBe("https://xai.test/v1/videos/generations?trace=1")
                expect(JSON.parse(call.body)).toEqual({
                  model: "grok-imagine-video-1.5",
                  prompt: "Make the water crash down",
                  image: { url: "data:image/png;base64,AQID" },
                  last_frame: { url: "https://example.test/last.png" },
                  reference_images: [{ file_id: "file_1" }],
                  duration: 10,
                  aspect_ratio: "16:9",
                  resolution: "720p",
                  generate_audio: false,
                  reference_audios: [{ voice_id: "eve" }],
                  future_option: true,
                })
                return json(input, { request_id: "req_1" })
              }
              expect(call.url).toBe("https://xai.test/v1/videos/req_1?trace=1")
              if (nth === 1) return json(input, { status: "pending", progress: 40 })
              return json(input, {
                status: "done",
                video: { url: "https://vidgen.x.ai/out.mp4", duration: 10, respect_moderation: true },
                model: "grok-imagine-video-1.5",
              })
            }),
          ),
        ),
      )
      expect(events).toEqual([
        { type: "generation-progress", id: "req_1", progress: 0.4 },
        { type: "generation-finished", id: "req_1", status: "completed" },
      ])
      expect(response.video.source).toEqual({ type: "url", url: "https://vidgen.x.ai/out.mp4", mediaType: "video/mp4" })
      expect(response.video.info).toEqual({ durationSeconds: 10 })
      expect(response.providerMetadata).toEqual({
        xai: { requestId: "req_1", model: "grok-imagine-video-1.5", respectModeration: true },
      })
    }),
  )

  it.effect("routes a source video to edits by default and to extensions on request", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const source = Media.url("https://example.test/in.mp4")
      yield* Effect.gen(function* () {
        yield* Video.start({ model, prompt: "brighter", video: source })
        yield* Video.start({ model, prompt: "keep going", video: source, providerOptions: { mode: "extend" } })
      }).pipe(
        Effect.provide(
          layer((input) => observe(calls, input).pipe(Effect.map(() => json(input, { request_id: "req_2" })))),
        ),
      )
      expect(calls.map((call) => call.url)).toEqual([
        "https://xai.test/v1/videos/edits",
        "https://xai.test/v1/videos/extensions",
      ])
      expect(calls.map((call) => JSON.parse(call.body))).toEqual([
        { model: "grok-imagine-video-1.5", prompt: "brighter", video: { url: "https://example.test/in.mp4" } },
        { model: "grok-imagine-video-1.5", prompt: "keep going", video: { url: "https://example.test/in.mp4" } },
      ])
    }),
  )

  for (const terminal of [
    {
      body: { status: "failed", error: { code: "invalid_argument", message: "Prompt cannot be empty." } },
      tag: "InvalidRequest",
      message: "xAI Video generation failed (invalid_argument): Prompt cannot be empty.",
    },
    {
      body: { status: "failed", error: { code: "failed_precondition", message: "Extension is not supported." } },
      tag: "InvalidRequest",
      message: "xAI Video generation failed (failed_precondition): Extension is not supported.",
    },
    {
      body: { status: "failed", error: { code: "permission_denied", message: "Team lacks access." } },
      tag: "Authentication",
      message: "xAI Video generation failed (permission_denied): Team lacks access.",
    },
    {
      body: { status: "failed", error: { code: "service_unavailable", message: "Overloaded." } },
      tag: "ProviderInternal",
      message: "xAI Video generation failed (service_unavailable): Overloaded.",
    },
    {
      body: { status: "failed", error: { code: "internal_error", message: "Generation failed." } },
      tag: "ProviderInternal",
      message: "xAI Video generation failed (internal_error): Generation failed.",
    },
    {
      body: { status: "failed", error: { code: "constructor", message: "Future code." } },
      tag: "ProviderInternal",
      message: "xAI Video generation failed (constructor): Future code.",
    },
    { body: { status: "expired" }, tag: "InvalidRequest", message: "xAI Video request req_1 expired" },
  ]) {
    it.effect(`surfaces ${terminal.body.error?.code ?? terminal.body.status} generations with the provider body`, () =>
      Effect.gen(function* () {
        const error = yield* Video.generate({ model, prompt: "x" }).pipe(Effect.flip)
        expect(error.reason._tag).toBe(terminal.tag)
        expect(error.message).toBe(terminal.message)
        expect(error.reason.body).toBe(JSON.stringify(terminal.body))
      }).pipe(
        Effect.provide(
          layer((input) =>
            Effect.succeed(
              input.request.method === "POST" ? json(input, { request_id: "req_1" }) : json(input, terminal.body),
            ),
          ),
        ),
      ),
    )
  }

  it.effect("returns moderated results and fails withheld videos as a content policy failure", () =>
    Effect.gen(function* () {
      const flagged = yield* Video.generate({ model, prompt: "x" }).pipe(
        Effect.provide(
          layer((input) =>
            Effect.succeed(
              input.request.method === "POST"
                ? json(input, { request_id: "req_1" })
                : json(input, {
                    status: "done",
                    video: { url: "https://vidgen.x.ai/o.mp4", respect_moderation: false },
                  }),
            ),
          ),
        ),
      )
      expect(flagged.providerMetadata).toEqual({ xai: { requestId: "req_1", respectModeration: false } })
      const withheld = yield* Video.generate({ model, prompt: "x" }).pipe(
        Effect.flip,
        Effect.provide(
          layer((input) =>
            Effect.succeed(
              input.request.method === "POST"
                ? json(input, { request_id: "req_1" })
                : json(input, { status: "done", video: { respect_moderation: false } }),
            ),
          ),
        ),
      )
      expect(withheld.reason._tag).toBe("ContentPolicy")
    }),
  )

  it.effect("rejects seed, negativePrompt, and n before sending", () =>
    Effect.gen(function* () {
      const tags = yield* Effect.forEach(
        [
          Video.generate({ model, prompt: "x", seed: 1 }),
          Video.generate({ model, prompt: "x", negativePrompt: "blur" }),
          Video.generate({ model, prompt: "x", n: 2 }),
        ],
        (program) =>
          program.pipe(
            Effect.flip,
            Effect.map((error) => error.reason._tag),
          ),
      )
      expect(tags).toEqual(["UnsupportedOperation", "UnsupportedOperation", "UnsupportedOperation"])
    }).pipe(Effect.provide(layer(() => Effect.die("unsupported input reached the network")))),
  )

  it.effect("resumes from a JSON round-tripped token and rejects foreign tokens", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const program = Effect.gen(function* () {
        const started = yield* Video.start({ model, prompt: "x" })
        const token: unknown = JSON.parse(JSON.stringify(started.token))
        const resumed = yield* Video.resume(model, token)
        expect(resumed.status).toBe("running")
        expect(resumed.progress).toBe(0.25)
        expect(resumed.token).toEqual({ requestID: "req_1" })
        const response = yield* resumed.await({ poll: { interval: "1 second" } })
        expect(response.videos).toHaveLength(1)
        const foreign = yield* Video.resume(model, { operation: "models/x/operations/y" }).pipe(Effect.flip)
        expect(foreign.reason._tag).toBe("InvalidRequest")
        expect(foreign.message).toContain("cannot resume")
      })
      yield* settle(program, 2).pipe(
        Effect.provide(
          layer((input) =>
            Effect.gen(function* () {
              const { call, nth } = yield* observe(calls, input)
              if (call.method === "POST") return json(input, { request_id: "req_1" })
              if (nth <= 2) return json(input, { status: "pending", progress: 25 })
              return json(input, { status: "done", video: { url: "https://vidgen.x.ai/out.mp4" } })
            }),
          ),
        ),
      )
      expect(calls.filter((call) => call.method === "GET")).toHaveLength(4)
    }),
  )

  it.effect("streams progress observations followed by the video and finish events", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const program = Video.stream({ model, prompt: "x" }, { poll: { interval: "1 second" } }).pipe(Stream.runCollect)
      const events = Array.from(
        yield* settle(program, 3).pipe(
          Effect.provide(
            layer((input) =>
              Effect.gen(function* () {
                const { call, nth } = yield* observe(calls, input)
                if (call.method === "POST") return json(input, { request_id: "req_1" })
                if (nth === 1) return json(input, { status: "pending", progress: 20 })
                if (nth === 2) return json(input, { status: "pending", progress: 50 })
                return json(input, { status: "done", video: { url: "https://vidgen.x.ai/out.mp4" } })
              }),
            ),
          ),
        ),
      )
      expect(events.map((event) => event.type)).toEqual([
        "generation-progress",
        "generation-progress",
        "video",
        "finish",
      ])
      expect(events[1]).toEqual({ type: "generation-progress", id: "req_1", progress: 0.5 })
    }),
  )

  it.effect("streams the observations of a failed generation and then fails with the provider body", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const events: Array<VideoEvent> = []
      const failed = { status: "failed", error: { code: "internal_error", message: "Generation failed." } }
      const program = Video.stream({ model, prompt: "x" }, { poll: { interval: "1 second" } }).pipe(
        Stream.runForEach((event) => Effect.sync(() => events.push(event))),
        Effect.flip,
      )
      const error = yield* settle(program, 3).pipe(
        Effect.provide(
          layer((input) =>
            Effect.gen(function* () {
              const { call, nth } = yield* observe(calls, input)
              if (call.method === "POST") return json(input, { request_id: "req_1" })
              if (nth === 1) return json(input, { status: "pending", progress: 20 })
              if (nth === 2) return json(input, { status: "pending", progress: 50 })
              return json(input, failed)
            }),
          ),
        ),
      )
      expect(events).toEqual([
        { type: "generation-progress", id: "req_1", progress: 0.2 },
        { type: "generation-progress", id: "req_1", progress: 0.5 },
      ])
      expect(error.reason._tag).toBe("ProviderInternal")
      expect(error.message).toBe("xAI Video generation failed (internal_error): Generation failed.")
      expect(error.reason.body).toBe(JSON.stringify(failed))
      expect(error.reason.http?.status).toBe(200)
    }),
  )

  it.effect("fails a stream with a Timeout reason once polling passes the poll deadline", () =>
    Effect.gen(function* () {
      const program = Video.stream(
        { model, prompt: "x" },
        { poll: { interval: "1 second", timeout: "2 seconds" } },
      ).pipe(Stream.runCollect, Effect.flip)
      const error = yield* settle(program, 3).pipe(
        Effect.provide(
          layer((input) =>
            Effect.succeed(
              input.request.method === "POST"
                ? json(input, { request_id: "req_1" })
                : json(input, { status: "pending" }),
            ),
          ),
        ),
      )
      expect(error.reason._tag).toBe("Timeout")
      expect(error.message).toContain("req_1")
    }),
  )
})

// ---------------------------------------------------------------------------
// Transient read failures
// ---------------------------------------------------------------------------

describe("Video / transient read failures", () => {
  const model = XAI.configure({ apiKey: "test", baseURL: "https://xai.test/v1" }).video("grok-imagine-video-1.5")
  const succeeded = { status: "done", video: { url: "https://vidgen.x.ai/out.mp4" } }
  const failure = (input: HandlerInput, status: number, headers?: Record<string, string>) =>
    json(input, { error: `HTTP ${status}` }, { status, headers })
  const methods = (calls: ReadonlyArray<Call>) => calls.map((call) => call.method)

  it.effect("retries a 503 status poll and a 503 result read, then returns the result", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const response = yield* settle(
        Video.generate({ model, prompt: "x" }, { poll: { interval: "1 second" } }),
        5,
      ).pipe(
        Effect.provide(
          layer((input) =>
            Effect.gen(function* () {
              const { call, nth } = yield* observe(calls, input)
              if (call.method === "POST") return json(input, { request_id: "req_1" })
              // 1: status fails, 2: status succeeds, 3: result fails, 4: result succeeds.
              if (nth === 1 || nth === 3) return failure(input, 503)
              return json(input, succeeded)
            }),
          ),
        ),
      )
      expect(response.video.source).toMatchObject({ type: "url", url: "https://vidgen.x.ai/out.mp4" })
      expect(methods(calls)).toEqual(["POST", "GET", "GET", "GET", "GET"])
    }),
  )

  it.effect("waits for a 429 retry-after before polling again", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const fiber = yield* Effect.forkChild(
        Video.generate({ model, prompt: "x" }, { poll: { interval: "1 second" } }).pipe(
          Effect.provide(
            layer((input) =>
              Effect.gen(function* () {
                const { call, nth } = yield* observe(calls, input)
                if (call.method === "POST") return json(input, { request_id: "req_1" })
                if (nth === 1) return failure(input, 429, { "retry-after": "10" })
                return json(input, succeeded)
              }),
            ),
          ),
        ),
      )
      yield* TestClock.adjust("9 seconds")
      expect(methods(calls)).toEqual(["POST", "GET"])
      yield* TestClock.adjust("1 second")
      yield* Fiber.join(fiber)
      expect(methods(calls)).toEqual(["POST", "GET", "GET", "GET"])
    }),
  )

  it.effect("fails a 400 status poll without retrying", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const error = yield* Video.generate({ model, prompt: "x" }).pipe(
        Effect.flip,
        Effect.provide(
          layer((input) =>
            Effect.gen(function* () {
              const { call } = yield* observe(calls, input)
              return call.method === "POST" ? json(input, { request_id: "req_1" }) : failure(input, 400)
            }),
          ),
        ),
      )
      expect(error.reason._tag).toBe("InvalidRequest")
      expect(methods(calls)).toEqual(["POST", "GET"])
    }),
  )

  it.effect("stops retrying at poll.timeout with a Timeout reason", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const error = yield* settle(
        Video.generate({ model, prompt: "x" }, { poll: { interval: "1 second", timeout: "5 seconds" } }).pipe(
          Effect.flip,
        ),
        6,
      ).pipe(
        Effect.provide(
          layer((input) =>
            Effect.gen(function* () {
              const { call } = yield* observe(calls, input)
              return call.method === "POST" ? json(input, { request_id: "req_1" }) : failure(input, 503)
            }),
          ),
        ),
      )
      expect(error.reason._tag).toBe("Timeout")
      expect(calls.filter((call) => call.method === "GET").length).toBeGreaterThan(1)
    }),
  )

  it.effect("bounds a streamed result read's retries by poll.timeout", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const error = yield* settle(
        Video.stream({ model, prompt: "x" }, { poll: { interval: "1 second", timeout: "5 seconds" } }).pipe(
          Stream.runCollect,
          Effect.flip,
        ),
        6,
      ).pipe(
        Effect.provide(
          layer((input) =>
            Effect.gen(function* () {
              const { call, nth } = yield* observe(calls, input)
              if (call.method === "POST") return json(input, { request_id: "req_1" })
              return nth === 1 ? json(input, succeeded) : failure(input, 503)
            }),
          ),
        ),
      )
      expect(error.reason._tag).toBe("Timeout")
      expect(calls.filter((call) => call.method === "GET").length).toBeGreaterThan(2)
    }),
  )

  it.effect("never retries a failed submit", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const error = yield* Video.generate({ model, prompt: "x" }).pipe(
        Effect.flip,
        Effect.provide(layer((input) => observe(calls, input).pipe(Effect.map(() => failure(input, 503))))),
      )
      expect(error.reason._tag).toBe("ProviderInternal")
      expect(methods(calls)).toEqual(["POST"])
    }),
  )
})

// ---------------------------------------------------------------------------
// Shared queued behavior
// ---------------------------------------------------------------------------

describe("Video / queued result", () => {
  const model = XAI.configure({ apiKey: "test", baseURL: "https://xai.test/v1" }).video("grok-imagine-video-1.5")
  const running = { status: "pending", progress: 40 }

  it.effect("rejects reading a result before the generation finishes", () =>
    Effect.gen(function* () {
      const generation = yield* Video.resume(model, { requestID: "req_1" })
      const error = yield* generation.result().pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toBe(
        `xAI Video generation ${generation.id} has not finished; await it before reading the result`,
      )
      expect(error.reason.body).toBe(JSON.stringify(running))
      expect(error.reason.http?.status).toBe(200)
    }).pipe(Effect.provide(layer((input) => Effect.succeed(json(input, running))))),
  )

  it.effect("resumes a generation from a JSON round-tripped token", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const response = yield* Effect.gen(function* () {
        const started = yield* Video.start({ model, prompt: "x" })
        const resumed = yield* Video.resume(model, JSON.parse(JSON.stringify(started.token)))
        expect(resumed.status).toBe("running")
        expect(resumed.token).toEqual({ requestID: "req_1" })
        return yield* resumed.await()
      }).pipe(
        Effect.provide(
          layer((input) =>
            Effect.gen(function* () {
              const { call, nth } = yield* observe(calls, input)
              if (call.method === "POST") return json(input, { request_id: "req_1" })
              if (nth === 1) return json(input, running)
              return json(input, {
                status: "done",
                video: { url: "https://vidgen.x.ai/out.mp4", respect_moderation: true },
              })
            }),
          ),
        ),
      )
      expect(response.video.source).toEqual(
        expect.objectContaining({ type: "url", url: "https://vidgen.x.ai/out.mp4" }),
      )
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        "POST https://xai.test/v1/videos/generations",
        "GET https://xai.test/v1/videos/req_1",
        "GET https://xai.test/v1/videos/req_1",
        "GET https://xai.test/v1/videos/req_1",
      ])
    }),
  )

  it.effect("cancels a generation without sending a request when the provider has no cancel endpoint", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      yield* Effect.gen(function* () {
        const generation = yield* Video.start({ model, prompt: "x" })
        yield* generation.cancel()
      }).pipe(
        Effect.provide(
          layer((input) =>
            Effect.gen(function* () {
              const { call } = yield* observe(calls, input)
              if (call.method !== "POST") return yield* Effect.die(`cancel sent ${call.method} ${call.url}`)
              return json(input, { request_id: "req_1" })
            }),
          ),
        ),
      )
      expect(calls.map((call) => call.method)).toEqual(["POST"])
    }),
  )

  it.effect("keeps polling through unknown statuses, including inherited property names", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const response = yield* settle(
        Video.generate(
          {
            model,
            prompt: "x",
          },
          { poll: { interval: "1 second" } },
        ),
        3,
      ).pipe(
        Effect.provide(
          layer((input) =>
            Effect.gen(function* () {
              const { call, nth } = yield* observe(calls, input)
              if (call.method === "POST") return json(input, { request_id: "req_1" })
              if (nth === 1) return json(input, { status: "warming_up" })
              if (nth === 2) return json(input, { status: "constructor" })
              return json(input, { status: "done", video: { url: "https://vidgen.x.ai/out.mp4" } })
            }),
          ),
        ),
      )
      expect(response.video.source).toMatchObject({ type: "url", url: "https://vidgen.x.ai/out.mp4" })
      expect(calls.map((call) => call.method)).toEqual(["POST", "GET", "GET", "GET", "GET"])
    }),
  )
})
