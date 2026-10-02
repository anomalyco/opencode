import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer, Stream } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { Media, Video, VideoClient, type GenerationEvent, type VideoEvent } from "../src/index.js"
import { Fal, Google, Runway, XAI } from "../src/providers.js"
import { it } from "./lib/effect.js"
import { dynamicResponse, json, observe, settle, type Call, type HandlerInput } from "./lib/http.js"

const layer = (handler: Parameters<typeof dynamicResponse>[0]) =>
  VideoClient.layer.pipe(Layer.provideMerge(dynamicResponse(handler)))

const DAY = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Google Veo
// ---------------------------------------------------------------------------

describe("Video / Google Veo", () => {
  const google = Google.configure({
    apiKey: "test",
    baseURL: "https://google.test/v1beta",
    headers: { "x-deployment": "yes" },
  })
  const model = google.video("veo-3.1-generate-preview")
  const operation = "models/veo-3.1-generate-preview/operations/op_1"
  const fileUri = "https://generativelanguage.googleapis.com/v1beta/files/abc:download?alt=media"

  it.effect("starts a predictLongRunning operation, polls it, and returns an authenticated download URL", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const program = Effect.gen(function* () {
        const generation = yield* Video.start({
          model,
          prompt: "A calico kitten sleeping in the sunshine",
          frames: {
            first: Media.bytes(Uint8Array.from([1, 2, 3]), "image/png"),
            last: Media.fromDataUrl("data:image/jpeg;base64,BAUG"),
          },
          references: [Media.bytes(Uint8Array.from([7, 8, 9]), "image/png")],
          durationSeconds: 8,
          aspectRatio: "16:9",
          resolution: "1080p",
          negativePrompt: "text, watermark",
          seed: 42,
          audio: true,
          providerOptions: { personGeneration: "allow_adult", futureOption: true },
          http: { body: { parameters: { httpOption: "yes" } } },
        })
        expect(generation.id).toBe(operation)
        expect(generation.status).toBe("running")
        expect(generation.token).toEqual({ operation })
        const response = yield* generation.await({ poll: { interval: "1 second" } })
        // Download credentials stay off the wire model: not in `source`, not in JSON, only on the live instance.
        expect(response.video.source).toEqual({
          type: "url",
          url: fileUri,
          mediaType: "video/mp4",
          expiresAt: 1000 + 2 * DAY,
        })
        // Only what `Auth` added travels with the asset; deployment headers stay on the route.
        expect(response.video.headers).toEqual({ "x-goog-api-key": "test" })
        expect(JSON.stringify(response.video)).not.toContain("x-goog-api-key")
        expect(Media.from(response.video.source).headers).toBeUndefined()
        expect(response.notices).toEqual([
          {
            type: "filtered",
            message: "Google Veo filtered media: audio filtered",
            providerMetadata: { google: { raiMediaFilteredReason: "audio filtered" } },
          },
        ])
        expect(response.providerMetadata).toEqual({
          google: { operation, raiMediaFilteredCount: 1, metadata: undefined },
        })
        expect(yield* response.video.bytes()).toEqual(Uint8Array.from([9, 9, 9]))
      })
      yield* settle(program, 1).pipe(
        Effect.provide(
          layer((input) =>
            Effect.gen(function* () {
              const { call, nth } = yield* observe(calls, input)
              expect(call.headers.get("x-goog-api-key")).toBe("test")
              if (call.url !== fileUri) expect(call.headers.get("x-deployment")).toBe("yes")
              if (call.method === "POST") {
                expect(call.url).toBe("https://google.test/v1beta/models/veo-3.1-generate-preview:predictLongRunning")
                expect(JSON.parse(call.body)).toEqual({
                  instances: [
                    {
                      prompt: "A calico kitten sleeping in the sunshine",
                      image: { inlineData: { mimeType: "image/png", data: "AQID" } },
                      lastFrame: { inlineData: { mimeType: "image/jpeg", data: "BAUG" } },
                      referenceImages: [
                        { image: { inlineData: { mimeType: "image/png", data: "BwgJ" } }, referenceType: "asset" },
                      ],
                    },
                  ],
                  parameters: {
                    aspectRatio: "16:9",
                    resolution: "1080p",
                    durationSeconds: 8,
                    negativePrompt: "text, watermark",
                    seed: 42,
                    personGeneration: "allow_adult",
                    futureOption: true,
                    httpOption: "yes",
                  },
                })
                return json(input, { name: operation })
              }
              if (call.url === fileUri) return input.respond(Uint8Array.from([9, 9, 9]))
              expect(call.url).toBe(`https://google.test/v1beta/${operation}`)
              if (nth === 1) return json(input, { name: operation, done: false })
              return json(input, {
                name: operation,
                done: true,
                response: {
                  generateVideoResponse: {
                    generatedSamples: [{ video: { uri: fileUri } }],
                    raiMediaFilteredCount: 1,
                    raiMediaFilteredReasons: ["audio filtered"],
                  },
                },
              })
            }),
          ),
        ),
      )
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        "POST https://google.test/v1beta/models/veo-3.1-generate-preview:predictLongRunning",
        `GET https://google.test/v1beta/${operation}`,
        `GET https://google.test/v1beta/${operation}`,
        `GET https://google.test/v1beta/${operation}`,
        `GET ${fileUri}`,
      ])
    }),
  )

  it.effect("hands the asset the auth header that overwrote a deployment header", () =>
    Effect.gen(function* () {
      const generation = yield* Video.start({
        model: Google.configure({
          apiKey: "test",
          baseURL: "https://google.test/v1beta",
          headers: { "x-goog-api-key": "stale" },
        }).video("veo-3.1-generate-preview"),
        prompt: "A kite",
      })
      const response = yield* generation.result()
      expect(response.video.headers).toEqual({ "x-goog-api-key": "test" })
    }).pipe(
      Effect.provide(
        layer((input) =>
          input.request.method === "POST"
            ? Effect.succeed(json(input, { name: operation }))
            : Effect.succeed(
                json(input, {
                  name: operation,
                  done: true,
                  response: { generateVideoResponse: { generatedSamples: [{ video: { uri: fileUri } }] } },
                }),
              ),
        ),
      ),
    ),
  )

  for (const terminal of [
    { error: { code: 3, message: "Prompt violates policy", status: "INVALID_ARGUMENT" }, tag: "InvalidRequest" },
    { error: { code: 9, message: "Unsupported resolution", status: "FAILED_PRECONDITION" }, tag: "InvalidRequest" },
    { error: { code: 11, message: "Duration out of range", status: "OUT_OF_RANGE" }, tag: "InvalidRequest" },
    { error: { code: 7, message: "Permission denied", status: "PERMISSION_DENIED" }, tag: "Authentication" },
    { error: { code: 16, message: "Invalid credentials", status: "UNAUTHENTICATED" }, tag: "Authentication" },
    { error: { code: 8, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" }, tag: "RateLimit" },
    { error: { code: 13, message: "Internal error", status: "INTERNAL" }, tag: "ProviderInternal" },
    { error: { code: 14, message: "Service unavailable", status: "UNAVAILABLE" }, tag: "ProviderInternal" },
    { error: { message: "Something broke" }, tag: "ProviderInternal" },
  ]) {
    it.effect(
      `surfaces ${terminal.error.status ?? "an uncoded"} operation error as ${terminal.tag} with the provider body`,
      () =>
        Effect.gen(function* () {
          const failure = { name: operation, done: true, error: terminal.error }
          const error = yield* Video.generate({ model, prompt: "nope" }).pipe(
            Effect.flip,
            Effect.provide(
              layer((input) =>
                Effect.succeed(
                  input.request.method === "POST" ? json(input, { name: operation }) : json(input, failure),
                ),
              ),
            ),
          )
          expect(error.reason._tag).toBe(terminal.tag)
          expect(error.message).toBe(`Google Veo operation failed: ${terminal.error.message}`)
          expect(error.reason.body).toBe(JSON.stringify(failure))
          expect(error.reason.http?.status).toBe(200)
        }),
    )
  }

  it.effect("reports fully filtered output as a content policy failure", () =>
    Effect.gen(function* () {
      const error = yield* Video.generate({ model, prompt: "nope" }).pipe(
        Effect.flip,
        Effect.provide(
          layer((input) =>
            Effect.succeed(
              input.request.method === "POST"
                ? json(input, { name: operation })
                : json(input, {
                    done: true,
                    response: {
                      generateVideoResponse: { raiMediaFilteredCount: 1, raiMediaFilteredReasons: ["safety"] },
                    },
                  }),
            ),
          ),
        ),
      )
      expect(error.reason._tag).toBe("ContentPolicy")
      expect(error.message).toContain("safety")
    }),
  )

  it.effect("rejects unsupported inputs before any network call", () =>
    Effect.gen(function* () {
      const cases = [
        Video.generate({ model, prompt: "x", n: 2 }),
        Video.generate({ model, prompt: "x", audio: false }),
        Video.generate({ model, prompt: "x", frames: { last: Media.bytes(Uint8Array.from([1]), "image/png") } }),
        Video.generate({ model, prompt: "x", frames: { first: Media.url("https://example.test/first.png") } }),
      ]
      const tags = yield* Effect.forEach(cases, (program) =>
        program.pipe(
          Effect.flip,
          Effect.map((error) => error.reason._tag),
        ),
      )
      expect(tags).toEqual(["UnsupportedOperation", "UnsupportedOperation", "InvalidRequest", "InvalidRequest"])
    }).pipe(Effect.provide(layer(() => Effect.die("unsupported input reached the network")))),
  )
})

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
          aspectRatio: "16:9",
          resolution: "720p",
          audio: false,
          providerOptions: { reference_audios: [{ voice_id: "eve" }], future_option: true },
          http: { headers: { "x-request": "yes" }, query: { trace: "1" } },
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
      expect(response.notices).toBeUndefined()
      expect(response.providerMetadata).toEqual({ xai: { requestId: "req_1", model: "grok-imagine-video-1.5" } })
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

  it.effect("flags moderated results as a notice and withheld videos as a content policy failure", () =>
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
      expect(flagged.notices).toEqual([
        { type: "moderated", message: "xAI Video flagged the generated video for moderation" },
      ])
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
})

// ---------------------------------------------------------------------------
// fal
// ---------------------------------------------------------------------------

describe("Video / fal", () => {
  const fal = Fal.configure({ apiKey: "test", baseURL: "https://queue.fal.test" })
  const model = fal.video("fal-ai/veo3.1")
  const urls = {
    status: "https://queue.fal.test/fal-ai/veo3.1/requests/r1/status",
    response: "https://queue.fal.test/fal-ai/veo3.1/requests/r1",
    cancel: "https://queue.fal.test/fal-ai/veo3.1/requests/r1/cancel",
  }
  const submitted = {
    request_id: "r1",
    status_url: urls.status,
    response_url: urls.response,
    cancel_url: urls.cancel,
    queue_position: 2,
  }

  it.effect("submits to the queue and follows the provider's status, response, and cancel URLs", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const program = Effect.gen(function* () {
        const generation = yield* Video.start({
          model,
          prompt: "Two person street interview",
          frames: { first: Media.url("https://example.test/first.png") },
          negativePrompt: "blur",
          seed: 7,
          aspectRatio: "9:16",
          resolution: "1080p",
          audio: true,
          providerOptions: { duration: "8s", safety_tolerance: "4" },
        })
        expect(generation.status).toBe("queued")
        expect(generation.position).toBe(2)
        expect(generation.token).toEqual({
          requestID: "r1",
          statusURL: urls.status,
          responseURL: urls.response,
          cancelURL: urls.cancel,
        })
        const queued = yield* generation.refresh()
        expect(queued.status).toBe("queued")
        expect(queued.position).toBe(1)
        const response = yield* generation.await({ poll: { interval: "1 second" } })
        yield* generation.cancel()
        return response
      })
      const response = yield* settle(program, 3).pipe(
        Effect.provide(
          layer((input) =>
            Effect.gen(function* () {
              const { call, nth } = yield* observe(calls, input)
              expect(call.headers.get("authorization")).toBe("Key test")
              if (call.method === "POST") {
                expect(call.url).toBe("https://queue.fal.test/fal-ai/veo3.1")
                expect(JSON.parse(call.body)).toEqual({
                  prompt: "Two person street interview",
                  negative_prompt: "blur",
                  seed: 7,
                  aspect_ratio: "9:16",
                  resolution: "1080p",
                  generate_audio: true,
                  image_url: "https://example.test/first.png",
                  duration: "8s",
                  safety_tolerance: "4",
                })
                return json(input, submitted)
              }
              if (call.method === "PUT") {
                expect(call.url).toBe(urls.cancel)
                return json(input, { status: "CANCELLATION_REQUESTED" }, { status: 202 })
              }
              if (call.url === urls.response)
                return json(input, {
                  video: {
                    url: "https://v3.fal.media/out.mp4",
                    content_type: "video/mp4",
                    file_name: "out.mp4",
                    file_size: 10,
                  },
                  seed: 7,
                  has_nsfw_concepts: [false],
                })
              expect(call.url).toBe(urls.status)
              if (nth === 1) return json(input, { status: "IN_QUEUE", queue_position: 1 })
              if (nth === 2) return json(input, { status: "IN_QUEUE", queue_position: 0 })
              if (nth === 3) return json(input, { status: "IN_PROGRESS", logs: [{ message: "Generating..." }] })
              return json(input, { status: "COMPLETED", metrics: { inference_time: 3.2 } })
            }),
          ),
        ),
      )
      expect(response.video.source).toEqual({
        type: "url",
        url: "https://v3.fal.media/out.mp4",
        mediaType: "video/mp4",
      })
      expect(response.providerMetadata).toEqual({
        fal: { requestId: "r1", seed: 7, fileName: "out.mp4", fileSize: 10, has_nsfw_concepts: [false] },
      })
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        "POST https://queue.fal.test/fal-ai/veo3.1",
        `GET ${urls.status}`,
        `GET ${urls.status}`,
        `GET ${urls.status}`,
        `GET ${urls.status}`,
        `GET ${urls.response}`,
        `PUT ${urls.cancel}`,
      ])
    }),
  )

  it.effect("treats a COMPLETED status carrying an error as failed", () =>
    Effect.gen(function* () {
      const generation = yield* Video.start({ model, prompt: "x" })
      const failed = yield* generation.refresh()
      expect(failed.status).toBe("failed")
    }).pipe(
      Effect.provide(
        layer((input) =>
          Effect.succeed(
            input.request.method === "POST"
              ? json(input, submitted)
              : json(input, { status: "COMPLETED", error: "Invalid input", error_type: "ValidationError" }),
          ),
        ),
      ),
    ),
  )

  for (const failure of [
    {
      name: "a COMPLETED status carrying an error",
      status: { status: "COMPLETED", error: "Invalid input", error_type: "ValidationError" },
      result: { status: 422, body: { detail: [{ loc: ["body", "prompt"], msg: "Invalid input" }] } },
      tag: "InvalidRequest",
    },
    {
      name: "a failing response_url",
      status: { status: "COMPLETED" },
      result: { status: 500, body: { detail: "Internal error" } },
      tag: "ProviderInternal",
    },
  ]) {
    it.effect(`fails await for ${failure.name} with the response_url body and HTTP context`, () =>
      Effect.gen(function* () {
        // A transient 500 on the result fetch is retried first; the body and HTTP context survive the final failure.
        const fiber = yield* Effect.forkChild(Video.generate({ model, prompt: "x" }).pipe(Effect.flip))
        yield* TestClock.adjust("5 minutes")
        const error = yield* Fiber.join(fiber)
        expect(error.reason._tag).toBe(failure.tag)
        expect(error.reason.body).toBe(JSON.stringify(failure.result.body))
        expect(error.reason.http).toMatchObject({ url: urls.response, status: failure.result.status })
      }).pipe(
        Effect.provide(
          layer((input) =>
            Effect.succeed(
              input.request.method === "POST"
                ? json(input, submitted)
                : input.request.url === urls.response
                  ? json(input, failure.result.body, { status: failure.result.status })
                  : json(input, failure.status),
            ),
          ),
        ),
      ),
    )
  }

  it.effect("rejects model-specific common fields and points at providerOptions", () =>
    Effect.gen(function* () {
      const errors = yield* Effect.forEach(
        [
          Video.generate({ model, prompt: "x", durationSeconds: 8 }),
          Video.generate({ model, prompt: "x", frames: { last: Media.url("https://example.test/last.png") } }),
          Video.generate({ model, prompt: "x", references: [Media.url("https://example.test/ref.png")] }),
          Video.generate({ model, prompt: "x", n: 2 }),
          Video.generate({ model, prompt: "x", frames: { first: Media.ref("fal", "handle") } }),
        ],
        (program) => program.pipe(Effect.flip),
      )
      expect(errors.map((error) => error.reason._tag)).toEqual([
        "UnsupportedOperation",
        "UnsupportedOperation",
        "UnsupportedOperation",
        "UnsupportedOperation",
        "InvalidRequest",
      ])
      expect(errors[1].message).toContain("end_image_url")
      expect(errors[4].message).toContain("; got fal:handle")
    }).pipe(Effect.provide(layer(() => Effect.die("unsupported input reached the network")))),
  )
})

// ---------------------------------------------------------------------------
// Runway
// ---------------------------------------------------------------------------

describe("Video / Runway", () => {
  const runway = Runway.configure({ apiKey: "test", baseURL: "https://runway.test/v1" })
  const model = runway.video("gen4.5")
  const taskUrl = "https://runway.test/v1/tasks/task_1"

  it.effect("submits image_to_video, polls the task, reports credits, and keeps the finished task on cancel", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const program = Effect.gen(function* () {
        const generation = yield* Video.start({
          model,
          prompt: "The kite lifts off",
          frames: {
            first: Media.url("https://example.test/first.png"),
            last: Media.ref("runway", "runway://upload-token"),
          },
          aspectRatio: "1280:720",
          durationSeconds: 5,
          seed: 3,
          audio: true,
          providerOptions: { contentModeration: { publicFigureThreshold: "low" } },
        })
        expect(generation.status).toBe("queued")
        expect(generation.token).toEqual({ taskID: "task_1" })
        const response = yield* generation.await({ poll: { interval: "1 second" } })
        yield* generation.cancel()
        return response
      })
      const response = yield* settle(program, 3).pipe(
        Effect.provide(
          layer((input) =>
            Effect.gen(function* () {
              const { call, nth } = yield* observe(calls, input)
              expect(call.headers.get("authorization")).toBe("Bearer test")
              expect(call.headers.get("x-runway-version")).toBe("2024-11-06")
              if (call.method === "POST") {
                expect(call.url).toBe("https://runway.test/v1/image_to_video")
                expect(JSON.parse(call.body)).toEqual({
                  model: "gen4.5",
                  promptText: "The kite lifts off",
                  promptImage: [
                    { uri: "https://example.test/first.png", position: "first" },
                    { uri: "runway://upload-token", position: "last" },
                  ],
                  ratio: "1280:720",
                  duration: 5,
                  seed: 3,
                  audio: true,
                  contentModeration: { publicFigureThreshold: "low" },
                })
                return json(input, { id: "task_1", estimatedCost: { credits: 25 } })
              }
              expect(call.url).toBe(taskUrl)
              if (call.method === "DELETE") return yield* Effect.die("cancel deleted a finished Runway task")
              if (nth === 1) return json(input, { id: "task_1", status: "PENDING", estimatedCost: { credits: 25 } })
              if (nth === 2) return json(input, { id: "task_1", status: "THROTTLED", estimatedCost: { credits: 25 } })
              if (nth === 3) return json(input, { id: "task_1", status: "RUNNING", progress: 0.5 })
              return json(input, {
                id: "task_1",
                status: "SUCCEEDED",
                output: ["https://dnznrvs05pmza.cloudfront.net/out.mp4"],
                cost: { credits: 20 },
              })
            }),
          ),
        ),
      )
      expect(response.video.source).toEqual({
        type: "url",
        url: "https://dnznrvs05pmza.cloudfront.net/out.mp4",
        mediaType: "video/mp4",
        expiresAt: 3000 + DAY,
      })
      expect(response.usage).toEqual({ type: "credits", credits: 20 })
      expect(response.providerMetadata).toEqual({ runway: { taskId: "task_1", estimatedCredits: undefined } })
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        "POST https://runway.test/v1/image_to_video",
        `GET ${taskUrl}`,
        `GET ${taskUrl}`,
        `GET ${taskUrl}`,
        `GET ${taskUrl}`,
        `GET ${taskUrl}`,
        `GET ${taskUrl}`,
      ])
    }),
  )

  it.effect("cancels a task that is still running", () =>
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
              if (call.method === "POST") return json(input, { id: "task_1" })
              if (call.method === "DELETE") return input.respond(null, { status: 204 })
              return json(input, { id: "task_1", status: "RUNNING", progress: 0.2 })
            }),
          ),
        ),
      )
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        "POST https://runway.test/v1/text_to_video",
        `GET ${taskUrl}`,
        `DELETE ${taskUrl}`,
      ])
    }),
  )

  it.effect("selects text_to_video with references and video_to_video for a source video", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      yield* Effect.gen(function* () {
        yield* Video.start({
          model,
          prompt: "A robot",
          references: [Media.bytes(Uint8Array.from([1, 2, 3]), "image/png")],
          negativePrompt: "blur",
          resolution: "720p",
        })
        yield* Video.start({ model, prompt: "Restyle", video: Media.url("https://example.test/in.mp4") })
      }).pipe(
        Effect.provide(layer((input) => observe(calls, input).pipe(Effect.map(() => json(input, { id: "task_2" }))))),
      )
      expect(calls.map((call) => call.url)).toEqual([
        "https://runway.test/v1/text_to_video",
        "https://runway.test/v1/video_to_video",
      ])
      expect(JSON.parse(calls[0].body)).toEqual({
        model: "gen4.5",
        promptText: "A robot",
        references: [{ uri: "data:image/png;base64,AQID" }],
        resolution: "720p",
        negativePrompt: "blur",
      })
      expect(JSON.parse(calls[1].body)).toEqual({
        model: "gen4.5",
        promptText: "Restyle",
        videoUri: "https://example.test/in.mp4",
      })
    }),
  )

  for (const terminal of [
    {
      body: { status: "FAILED", failure: "Input image flagged", failureCode: "SAFETY.INPUT.IMAGE" },
      tag: "ContentPolicy",
      message: "Runway task failed (SAFETY.INPUT.IMAGE): Input image flagged",
    },
    {
      body: { status: "FAILED", failure: "Something broke", failureCode: "INTERNAL.BAD_OUTPUT.CODE01" },
      tag: "ProviderInternal",
      message: "Runway task failed (INTERNAL.BAD_OUTPUT.CODE01): Something broke",
    },
    {
      body: { status: "FAILED", failure: "Unsupported dimensions", failureCode: "ASSET.INVALID" },
      tag: "InvalidRequest",
      message: "Runway task failed (ASSET.INVALID): Unsupported dimensions",
    },
    { body: { status: "CANCELLED" }, tag: "InvalidRequest", message: "Runway task task_1 was cancelled" },
  ]) {
    it.effect(`surfaces ${terminal.body.failureCode ?? terminal.body.status} with the task body`, () =>
      Effect.gen(function* () {
        const error = yield* Video.generate({ model, prompt: "x" }).pipe(Effect.flip)
        expect(error.reason._tag).toBe(terminal.tag)
        expect(error.message).toBe(terminal.message)
        expect(error.reason.body).toBe(JSON.stringify(terminal.body))
      }).pipe(
        Effect.provide(
          layer((input) =>
            Effect.succeed(
              input.request.method === "POST" ? json(input, { id: "task_1" }) : json(input, terminal.body),
            ),
          ),
        ),
      ),
    )
  }

  it.effect("rejects n before sending", () =>
    Video.generate({ model, prompt: "x", n: 2 }).pipe(
      Effect.flip,
      Effect.tap((error) => Effect.sync(() => expect(error.reason._tag).toBe("UnsupportedOperation"))),
      Effect.provide(layer(() => Effect.die("unsupported input reached the network"))),
    ),
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
        expect(resumed.token).toEqual({ taskID: "task_1" })
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
              if (call.method === "POST") return json(input, { id: "task_1" })
              if (nth <= 2) return json(input, { status: "RUNNING", progress: 0.25 })
              return json(input, { status: "SUCCEEDED", output: ["https://runway.test/out.mp4"] })
            }),
          ),
        ),
      )
      expect(calls.filter((call) => call.method === "GET")).toHaveLength(4)
    }),
  )

  it.effect("streams queue and progress observations followed by the video and finish events", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const program = Video.stream({ model, prompt: "x" }, { poll: { interval: "1 second" } }).pipe(Stream.runCollect)
      const events = Array.from(
        yield* settle(program, 3).pipe(
          Effect.provide(
            layer((input) =>
              Effect.gen(function* () {
                const { call, nth } = yield* observe(calls, input)
                if (call.method === "POST") return json(input, { id: "task_1" })
                if (nth === 1) return json(input, { status: "PENDING" })
                if (nth === 2) return json(input, { status: "RUNNING", progress: 0.5 })
                return json(input, {
                  status: "SUCCEEDED",
                  output: ["https://runway.test/out.mp4"],
                  cost: { credits: 5 },
                })
              }),
            ),
          ),
        ),
      )
      expect(events.map((event) => event.type)).toEqual(["generation-queued", "generation-progress", "video", "finish"])
      expect(events[1]).toEqual({ type: "generation-progress", id: "task_1", progress: 0.5 })
      expect(events[3]).toMatchObject({ type: "finish", usage: { type: "credits", credits: 5 } })
    }),
  )

  it.effect("streams the observations of a failed task and then fails with the task body", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const events: Array<VideoEvent> = []
      const failed = { status: "FAILED", failure: "Something broke", failureCode: "INTERNAL.BAD_OUTPUT.CODE01" }
      const program = Video.stream({ model, prompt: "x" }, { poll: { interval: "1 second" } }).pipe(
        Stream.runForEach((event) => Effect.sync(() => events.push(event))),
        Effect.flip,
      )
      const error = yield* settle(program, 3).pipe(
        Effect.provide(
          layer((input) =>
            Effect.gen(function* () {
              const { call, nth } = yield* observe(calls, input)
              if (call.method === "POST") return json(input, { id: "task_1" })
              if (nth === 1) return json(input, { status: "PENDING" })
              if (nth === 2) return json(input, { status: "RUNNING", progress: 0.5 })
              return json(input, failed)
            }),
          ),
        ),
      )
      expect(events).toEqual([
        { type: "generation-queued", id: "task_1", position: undefined },
        { type: "generation-progress", id: "task_1", progress: 0.5 },
      ])
      expect(error.reason._tag).toBe("ProviderInternal")
      expect(error.message).toBe("Runway task failed (INTERNAL.BAD_OUTPUT.CODE01): Something broke")
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
              input.request.method === "POST" ? json(input, { id: "task_1" }) : json(input, { status: "RUNNING" }),
            ),
          ),
        ),
      )
      expect(error.reason._tag).toBe("Timeout")
      expect(error.message).toContain("task_1")
    }),
  )
})

// ---------------------------------------------------------------------------
// Transient read failures
// ---------------------------------------------------------------------------

describe("Video / transient read failures", () => {
  const model = Runway.configure({ apiKey: "test", baseURL: "https://runway.test/v1" }).video("gen4.5")
  const succeeded = { id: "task_1", status: "SUCCEEDED", output: ["https://runway.test/out.mp4"] }
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
              if (call.method === "POST") return json(input, { id: "task_1" })
              // 1: status fails, 2: status succeeds, 3: result fails, 4: result succeeds.
              if (nth === 1 || nth === 3) return failure(input, 503)
              return json(input, succeeded)
            }),
          ),
        ),
      )
      expect(response.video.source).toMatchObject({ type: "url", url: "https://runway.test/out.mp4" })
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
                if (call.method === "POST") return json(input, { id: "task_1" })
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
              return call.method === "POST" ? json(input, { id: "task_1" }) : failure(input, 400)
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
              return call.method === "POST" ? json(input, { id: "task_1" }) : failure(input, 503)
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
              if (call.method === "POST") return json(input, { id: "task_1" })
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

  it.effect("never retries a failed cancel", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const error = yield* Effect.gen(function* () {
        const generation = yield* Video.start({ model, prompt: "x" })
        return yield* generation.cancel().pipe(Effect.flip)
      }).pipe(
        Effect.provide(
          layer((input) =>
            Effect.gen(function* () {
              const { call } = yield* observe(calls, input)
              if (call.method === "POST") return json(input, { id: "task_1" })
              if (call.method === "DELETE") return failure(input, 503)
              return json(input, { id: "task_1", status: "RUNNING" })
            }),
          ),
        ),
      )
      expect(error.reason._tag).toBe("ProviderInternal")
      expect(methods(calls)).toEqual(["POST", "GET", "DELETE"])
    }),
  )
})

// ---------------------------------------------------------------------------
// Shared queued behavior
// ---------------------------------------------------------------------------

describe("Video / queued result", () => {
  for (const pending of [
    {
      model: Google.configure({ apiKey: "test", baseURL: "https://google.test/v1beta" }).video("veo-3.1"),
      token: { operation: "models/veo-3.1/operations/op_1" },
      body: { name: "models/veo-3.1/operations/op_1", done: false },
      name: "Google Veo",
    },
    {
      model: XAI.configure({ apiKey: "test", baseURL: "https://xai.test/v1" }).video("grok-imagine-video-1.5"),
      token: { requestID: "req_1" },
      body: { status: "pending", progress: 40 },
      name: "xAI Video",
    },
    {
      model: Runway.configure({ apiKey: "test", baseURL: "https://runway.test/v1" }).video("gen4.5"),
      token: { taskID: "task_1" },
      body: { status: "RUNNING", progress: 0.5 },
      name: "Runway",
    },
  ]) {
    it.effect(`rejects reading a ${pending.model.provider} result before the generation finishes`, () =>
      Effect.gen(function* () {
        const generation = yield* Video.resume(pending.model, pending.token)
        const error = yield* generation.result().pipe(Effect.flip)
        expect(error.reason._tag).toBe("InvalidRequest")
        expect(error.message).toBe(
          `${pending.name} generation ${generation.id} has not finished; await it before reading the result`,
        )
        expect(error.reason.body).toBe(JSON.stringify(pending.body))
        expect(error.reason.http?.status).toBe(200)
      }).pipe(Effect.provide(layer((input) => Effect.succeed(json(input, pending.body))))),
    )
  }

  const veoOperation = "models/veo-3.1/operations/op_1"
  const falURLs = {
    status: "https://queue.fal.test/fal-ai/veo3.1/requests/r1/status",
    response: "https://queue.fal.test/fal-ai/veo3.1/requests/r1",
    cancel: "https://queue.fal.test/fal-ai/veo3.1/requests/r1/cancel",
  }
  for (const queued of [
    {
      model: Google.configure({ apiKey: "test", baseURL: "https://google.test/v1beta" }).video("veo-3.1"),
      submitted: { name: veoOperation },
      token: { operation: veoOperation },
      submitURL: "https://google.test/v1beta/models/veo-3.1:predictLongRunning",
      statusURL: `https://google.test/v1beta/${veoOperation}`,
      resultURL: `https://google.test/v1beta/${veoOperation}`,
      running: { name: veoOperation, done: false },
      done: {
        name: veoOperation,
        done: true,
        response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://google.test/out.mp4" } }] } },
      },
      result: undefined,
      url: "https://google.test/out.mp4",
    },
    {
      model: XAI.configure({ apiKey: "test", baseURL: "https://xai.test/v1" }).video("grok-imagine-video-1.5"),
      submitted: { request_id: "req_1" },
      token: { requestID: "req_1" },
      submitURL: "https://xai.test/v1/videos/generations",
      statusURL: "https://xai.test/v1/videos/req_1",
      resultURL: "https://xai.test/v1/videos/req_1",
      running: { status: "pending", progress: 40 },
      done: { status: "done", video: { url: "https://vidgen.x.ai/out.mp4", respect_moderation: true } },
      result: undefined,
      url: "https://vidgen.x.ai/out.mp4",
    },
    {
      model: Fal.configure({ apiKey: "test", baseURL: "https://queue.fal.test" }).video("fal-ai/veo3.1"),
      submitted: {
        request_id: "r1",
        status_url: falURLs.status,
        response_url: falURLs.response,
        cancel_url: falURLs.cancel,
      },
      token: { requestID: "r1", statusURL: falURLs.status, responseURL: falURLs.response, cancelURL: falURLs.cancel },
      submitURL: "https://queue.fal.test/fal-ai/veo3.1",
      statusURL: falURLs.status,
      resultURL: falURLs.response,
      running: { status: "IN_PROGRESS" },
      done: { status: "COMPLETED" },
      result: { video: { url: "https://v3.fal.media/out.mp4" } },
      url: "https://v3.fal.media/out.mp4",
    },
  ]) {
    it.effect(`resumes a ${queued.model.provider} generation from a JSON round-tripped token`, () =>
      Effect.gen(function* () {
        const calls: Array<Call> = []
        const response = yield* Effect.gen(function* () {
          const started = yield* Video.start({ model: queued.model, prompt: "x" })
          const resumed = yield* Video.resume(queued.model, JSON.parse(JSON.stringify(started.token)))
          expect(resumed.status).toBe("running")
          expect(resumed.token).toEqual(queued.token)
          return yield* resumed.await()
        }).pipe(
          Effect.provide(
            layer((input) =>
              Effect.gen(function* () {
                const { call, nth } = yield* observe(calls, input)
                if (call.method === "POST") return json(input, queued.submitted)
                if (call.url === queued.resultURL && queued.result !== undefined) return json(input, queued.result)
                return json(input, nth === 1 ? queued.running : queued.done)
              }),
            ),
          ),
        )
        expect(response.video.source).toEqual(expect.objectContaining({ type: "url", url: queued.url }))
        expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
          `POST ${queued.submitURL}`,
          `GET ${queued.statusURL}`,
          `GET ${queued.statusURL}`,
          `GET ${queued.resultURL}`,
        ])
      }),
    )
  }

  for (const queued of [
    {
      model: Google.configure({ apiKey: "test", baseURL: "https://google.test/v1beta" }).video("veo-3.1"),
      submitted: { name: veoOperation },
    },
    {
      model: XAI.configure({ apiKey: "test", baseURL: "https://xai.test/v1" }).video("grok-imagine-video-1.5"),
      submitted: { request_id: "req_1" },
    },
  ]) {
    it.effect(`cancels a ${queued.model.provider} generation without sending a request`, () =>
      Effect.gen(function* () {
        const calls: Array<Call> = []
        yield* Effect.gen(function* () {
          const generation = yield* Video.start({ model: queued.model, prompt: "x" })
          yield* generation.cancel()
        }).pipe(
          Effect.provide(
            layer((input) =>
              Effect.gen(function* () {
                const { call } = yield* observe(calls, input)
                if (call.method !== "POST") return yield* Effect.die(`cancel sent ${call.method} ${call.url}`)
                return json(input, queued.submitted)
              }),
            ),
          ),
        )
        expect(calls.map((call) => call.method)).toEqual(["POST"])
      }),
    )
  }

  it.effect("rejects a status that only matches an inherited property", () =>
    Effect.gen(function* () {
      const error = yield* Video.resume(
        XAI.configure({ apiKey: "test", baseURL: "https://xai.test/v1" }).video("grok-imagine-video-1.5"),
        { requestID: "req_1" },
      ).pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidProviderOutput")
      expect(error.message).toBe('Unknown generation status "constructor"')
      expect(error.reason.body).toBe(JSON.stringify({ status: "constructor" }))
    }).pipe(Effect.provide(layer((input) => Effect.succeed(json(input, { status: "constructor" }))))),
  )
})
