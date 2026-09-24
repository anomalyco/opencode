import { describe, expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { Media, Video, VideoClient, type GenerationEvent } from "../src/index.js"
import { Fal, Google, Runway, XAI } from "../src/providers.js"
import { it } from "./lib/effect.js"
import { dynamicResponse, json, observe, settle, type Call } from "./lib/http.js"

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

  it.effect("surfaces an operation error as a failed generation with the provider body", () =>
    Effect.gen(function* () {
      const failure = {
        name: operation,
        done: true,
        error: { code: 3, message: "Prompt violates policy", status: "INVALID_ARGUMENT" },
      }
      const error = yield* Video.generate({ model, prompt: "nope" }).pipe(
        Effect.flip,
        Effect.provide(
          layer((input) =>
            Effect.succeed(input.request.method === "POST" ? json(input, { name: operation }) : json(input, failure)),
          ),
        ),
      )
      expect(error.reason._tag).toBe("ProviderInternal")
      expect(error.message).toBe("Google Veo operation failed: Prompt violates policy")
      expect(error.reason.body).toBe(JSON.stringify(failure))
      expect(error.reason.http?.status).toBe(200)
    }),
  )

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
      tag: "ProviderInternal",
      message: "xAI Video generation failed (invalid_argument): Prompt cannot be empty.",
    },
    { body: { status: "expired" }, tag: "InvalidRequest", message: "xAI Video request req_1 expired" },
  ]) {
    it.effect(`surfaces ${terminal.body.status} generations with the provider body`, () =>
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

  it.effect("submits image_to_video with the API version header, polls the task, and reports credits", () =>
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
              if (call.method === "DELETE") return input.respond(null, { status: 204 })
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
