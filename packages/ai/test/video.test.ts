import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer, Stream } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { AIError, Media, VideoClient, ai } from "../src/effect.js"
import { XAI } from "../src/providers.js"
import { it } from "./lib/effect.js"
import { dynamicResponse, json, observe, settle, type Call, type HandlerInput } from "./lib/http.js"

const layer = (handler: Parameters<typeof dynamicResponse>[0]) =>
  VideoClient.layer.pipe(Layer.provideMerge(dynamicResponse(handler)))

const xai = XAI.configure({ apiKey: "test", baseURL: "https://xai.test/v1" })
const model = xai.video("grok-imagine-video-1.5")
const done = { status: "done", video: { url: "https://vidgen.x.ai/out.mp4" } }

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

describe("ai.video.start / xAI", () => {
  it.effect("maps the request onto xAI's body and returns the job without polling", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const job = yield* ai.video
        .start({
          model,
          prompt: "Make the water crash down",
          start: Media.image(Media.fromDataUrl("data:image/png;base64,AQID")),
          end: "https://example.test/last.png",
          references: [
            Media.ref("xai", "file_1"),
            Media.url("https://example.test/voice.mp3", { mediaType: "audio/mpeg" }),
          ],
          duration: "10 seconds",
          aspect: "16:9",
          resolution: "720p",
          sound: false,
          providerOptions: { future_option: true },
          headers: { "x-request": "yes" },
          http: { query: { trace: "1" } },
        })
        .pipe(
          Effect.provide(
            layer((input) =>
              Effect.gen(function* () {
                const { call } = yield* observe(calls, input)
                expect(call.headers.get("authorization")).toBe("Bearer test")
                expect(call.headers.get("x-request")).toBe("yes")
                return json(input, { request_id: "req_1" })
              }),
            ),
          ),
        )
      expect(job).toEqual({ id: "req_1" })
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        "POST https://xai.test/v1/videos/generations?trace=1",
      ])
      expect(JSON.parse(calls[0].body)).toEqual({
        model: "grok-imagine-video-1.5",
        prompt: "Make the water crash down",
        image: { url: "data:image/png;base64,AQID" },
        last_frame: { url: "https://example.test/last.png" },
        reference_images: [{ file_id: "file_1" }],
        reference_audios: [{ url: "https://example.test/voice.mp3" }],
        duration: 10,
        aspect_ratio: "16:9",
        resolution: "720p",
        generate_audio: false,
        future_option: true,
      })
    }),
  )

  it.effect("leaves aspect out for auto when a start image sets the shape, and sends it otherwise", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      yield* Effect.gen(function* () {
        yield* ai.video.start({ model, prompt: "x", start: "https://example.test/first.png", aspect: "auto" })
        yield* ai.video.start({ model, prompt: "x", aspect: "auto" })
      }).pipe(
        Effect.provide(
          layer((input) => observe(calls, input).pipe(Effect.map(() => json(input, { request_id: "req_1" })))),
        ),
      )
      expect(calls.map((call) => JSON.parse(call.body).aspect_ratio)).toEqual([undefined, "auto"])
    }),
  )

  it.effect("sends a native source video to edits or extensions through providerOptions.mode", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const video = { url: "https://example.test/in.mp4" }
      yield* Effect.gen(function* () {
        yield* ai.video.start({ model, prompt: "brighter", providerOptions: { mode: "edit", video } })
        yield* ai.video.start({ model, prompt: "keep going", providerOptions: { mode: "extend", video } })
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
        { model: "grok-imagine-video-1.5", prompt: "brighter", video },
        { model: "grok-imagine-video-1.5", prompt: "keep going", video },
      ])
    }),
  )

  it.effect("rejects reference videos, which xAI has no field for, before sending", () =>
    Effect.gen(function* () {
      const error = yield* ai.video
        .start({
          model,
          prompt: "x",
          references: [Media.url("https://example.test/motion.mp4", { mediaType: "video/mp4" })],
        })
        .pipe(Effect.flip)
      expect(error.reason._tag).toBe("UnsupportedOperation")
      expect(error.message).toContain("reference video")
    }).pipe(Effect.provide(layer(() => Effect.die("an unsupported reference reached the network")))),
  )

  it.effect("rejects start and end frames that are known not to be images before sending", () =>
    Effect.gen(function* () {
      const video = yield* ai.video.start({ model, prompt: "x", start: "data:video/mp4;base64,AAAA" }).pipe(Effect.flip)
      expect(video.reason._tag).toBe("InvalidRequest")
      expect(video.message).toContain("expected an image, got video/mp4")
      const audio = yield* ai.video
        .start({ model, prompt: "x", end: Media.url("https://example.test/a.mp3", { mediaType: "audio/mpeg" }) })
        .pipe(Effect.flip)
      expect(audio.reason._tag).toBe("InvalidRequest")
    }).pipe(Effect.provide(layer(() => Effect.die("a non-image frame reached the network")))),
  )

  it.effect("Media.image throws a typed AIError for a known non-image", () =>
    Effect.sync(() => {
      expect(() => Media.image("data:video/mp4;base64,AAAA")).toThrow(AIError)
      expect(() => Media.image("data:video/mp4;base64,AAAA")).toThrow("expected an image, got video/mp4")
    }),
  )

  it.effect("sends frames whose type it can't tell, like URLs and provider file references", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      yield* ai.video
        .start({ model, prompt: "x", start: "https://example.test/frame?id=7", end: Media.ref("xai", "file_1") })
        .pipe(
          Effect.provide(
            layer((input) => observe(calls, input).pipe(Effect.map(() => json(input, { request_id: "r" })))),
          ),
        )
      expect(JSON.parse(calls[0].body)).toMatchObject({
        image: { url: "https://example.test/frame?id=7" },
        last_frame: { file_id: "file_1" },
      })
    }),
  )

  it.effect("rejects durations that aren't seconds before sending", () =>
    Effect.gen(function* () {
      // @ts-expect-error Durations are Effect duration strings in seconds.
      const error = yield* ai.video.start({ model, prompt: "x", duration: 8 }).pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidRequest")
    }).pipe(Effect.provide(layer(() => Effect.die("an invalid request reached the network")))),
  )

  it.effect("never retries a failed submit", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const error = yield* ai.video
        .start({ model, prompt: "x" })
        .pipe(
          Effect.flip,
          Effect.provide(layer((input) => observe(calls, input).pipe(Effect.map(() => failure(input, 503))))),
        )
      expect(error.reason._tag).toBe("ProviderInternal")
      expect(calls.map((call) => call.method)).toEqual(["POST"])
    }),
  )
})

// ---------------------------------------------------------------------------
// status, result, cancel
// ---------------------------------------------------------------------------

describe("ai.video.status / result / cancel", () => {
  it.effect("reads one status per call by job ID", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const statuses = yield* Effect.gen(function* () {
        const job = yield* ai.video.start({ model, prompt: "x" })
        return [yield* ai.video.status(model, job.id), yield* ai.video.status(model, job.id)]
      }).pipe(
        Effect.provide(
          layer((input) =>
            Effect.gen(function* () {
              const { call, nth } = yield* observe(calls, input)
              if (call.method === "POST") return json(input, { request_id: "req_1" })
              return nth === 1 ? json(input, { status: "pending", progress: 40 }) : json(input, done)
            }),
          ),
        ),
      )
      expect(statuses).toEqual([{ status: "running", progress: 0.4 }, { status: "completed" }])
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        "POST https://xai.test/v1/videos/generations",
        "GET https://xai.test/v1/videos/req_1",
        "GET https://xai.test/v1/videos/req_1",
      ])
    }),
  )

  it.effect("encodes the job ID into the request path", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      yield* ai.video
        .status(model, "../files?x=1")
        .pipe(Effect.provide(layer((input) => observe(calls, input).pipe(Effect.map(() => json(input, done))))))
      expect(calls.map((call) => call.url)).toEqual(["https://xai.test/v1/videos/..%2Ffiles%3Fx%3D1"])
    }),
  )

  it.effect("keeps unknown statuses running, including inherited property names", () =>
    Effect.gen(function* () {
      const statuses = yield* Effect.forEach(["warming_up", "constructor"], (status) =>
        ai.video.status(model, "req_1").pipe(Effect.provide(layer((input) => Effect.succeed(json(input, { status }))))),
      )
      expect(statuses.map((value) => value.status)).toEqual(["running", "running"])
    }),
  )

  it.effect("returns the finished video as an expiring URL with xAI metadata", () =>
    Effect.gen(function* () {
      const response = yield* ai.video.result(model, "req_1")
      expect(response.video.source).toEqual({ type: "url", url: "https://vidgen.x.ai/out.mp4", mediaType: "video/mp4" })
      expect(response.video.info).toEqual({ durationSeconds: 10 })
      expect(response.providerMetadata).toEqual({
        xai: { requestId: "req_1", model: "grok-imagine-video-1.5", respectModeration: true },
      })
    }).pipe(
      Effect.provide(
        layer((input) =>
          Effect.succeed(
            json(input, {
              status: "done",
              video: { url: "https://vidgen.x.ai/out.mp4", duration: 10, respect_moderation: true },
              model: "grok-imagine-video-1.5",
            }),
          ),
        ),
      ),
    ),
  )

  it.effect("fails a result read before the job finishes", () =>
    Effect.gen(function* () {
      const error = yield* ai.video.result(model, "req_1").pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toBe("xAI Video generation req_1 has not finished; await it before reading the result")
      expect(error.reason.body).toBe(JSON.stringify({ status: "pending", progress: 40 }))
    }).pipe(Effect.provide(layer((input) => Effect.succeed(json(input, { status: "pending", progress: 40 }))))),
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
      body: { status: "failed", error: { code: "constructor", message: "Future code." } },
      tag: "ProviderInternal",
      message: "xAI Video generation failed (constructor): Future code.",
    },
    { body: { status: "expired" }, tag: "InvalidRequest", message: "xAI Video request req_1 expired" },
  ]) {
    it.effect(
      `fails the result of ${terminal.body.error?.code ?? terminal.body.status} jobs with the provider body`,
      () =>
        Effect.gen(function* () {
          const error = yield* ai.video.result(model, "req_1").pipe(Effect.flip)
          expect(error.reason._tag).toBe(terminal.tag)
          expect(error.message).toBe(terminal.message)
          expect(error.reason.body).toBe(JSON.stringify(terminal.body))
        }).pipe(Effect.provide(layer((input) => Effect.succeed(json(input, terminal.body))))),
    )
  }

  it.effect("returns moderated results and fails withheld videos as a content policy failure", () =>
    Effect.gen(function* () {
      const flagged = yield* ai.video
        .result(model, "req_1")
        .pipe(
          Effect.provide(
            layer((input) =>
              Effect.succeed(
                json(input, { status: "done", video: { url: "https://vidgen.x.ai/o.mp4", respect_moderation: false } }),
              ),
            ),
          ),
        )
      expect(flagged.providerMetadata).toEqual({ xai: { requestId: "req_1", respectModeration: false } })
      const withheld = yield* ai.video
        .result(model, "req_1")
        .pipe(
          Effect.flip,
          Effect.provide(
            layer((input) => Effect.succeed(json(input, { status: "done", video: { respect_moderation: false } }))),
          ),
        )
      expect(withheld.reason._tag).toBe("ContentPolicy")
    }),
  )

  it.effect("fails cancel as unsupported without sending a request, since xAI has no cancel endpoint", () =>
    Effect.gen(function* () {
      const error = yield* ai.video.cancel(model, "req_1").pipe(Effect.flip)
      expect(error.reason._tag).toBe("UnsupportedOperation")
      expect(error.message).toContain("cancel")
    }).pipe(Effect.provide(layer(() => Effect.die("cancel reached the network")))),
  )
})

// ---------------------------------------------------------------------------
// Transient read failures
// ---------------------------------------------------------------------------

const failure = (input: HandlerInput, status: number, headers?: Record<string, string>) =>
  json(input, { error: `HTTP ${status}` }, { status, headers })

describe("ai.video / transient read failures", () => {
  it.effect("retries a 503 status read and a 503 result read", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const response = yield* settle(
        Effect.gen(function* () {
          expect(yield* ai.video.status(model, "req_1")).toEqual({ status: "completed" })
          return yield* ai.video.result(model, "req_1")
        }),
        5,
      ).pipe(
        Effect.provide(
          layer((input) =>
            Effect.gen(function* () {
              const { nth } = yield* observe(calls, input)
              // 1: status fails, 2: status succeeds, 3: result fails, 4: result succeeds.
              return nth === 1 || nth === 3 ? failure(input, 503) : json(input, done)
            }),
          ),
        ),
      )
      expect(response.video.source).toMatchObject({ type: "url", url: "https://vidgen.x.ai/out.mp4" })
      expect(calls).toHaveLength(4)
    }),
  )

  it.effect("waits for a 429 retry-after before reading the status again", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const fiber = yield* Effect.forkChild(
        ai.video.status(model, "req_1").pipe(
          Effect.provide(
            layer((input) =>
              Effect.gen(function* () {
                const { nth } = yield* observe(calls, input)
                return nth === 1 ? failure(input, 429, { "retry-after": "10" }) : json(input, done)
              }),
            ),
          ),
        ),
      )
      yield* TestClock.adjust("9 seconds")
      expect(calls).toHaveLength(1)
      yield* TestClock.adjust("1 second")
      expect(yield* Fiber.join(fiber)).toEqual({ status: "completed" })
      expect(calls).toHaveLength(2)
    }),
  )

  it.effect("fails a 400 status read without retrying", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const error = yield* ai.video
        .status(model, "req_1")
        .pipe(
          Effect.flip,
          Effect.provide(layer((input) => observe(calls, input).pipe(Effect.map(() => failure(input, 400))))),
        )
      expect(error.reason._tag).toBe("InvalidRequest")
      expect(calls).toHaveLength(1)
    }),
  )
})

// ---------------------------------------------------------------------------
// Media streaming
// ---------------------------------------------------------------------------

describe("Media.Asset.stream", () => {
  it.effect("streams a URL asset's bytes from the network with its download headers", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const asset = Media.url("https://vidgen.x.ai/out.mp4", { mediaType: "video/mp4", headers: { "x-key": "k" } })
      const chunks = yield* asset
        .stream()
        .pipe(
          Stream.runCollect,
          Effect.provide(
            dynamicResponse((input) =>
              observe(calls, input).pipe(Effect.map(() => input.respond(new Uint8Array([1, 2, 3])))),
            ),
          ),
        )
      expect(new Uint8Array(chunks.flatMap((chunk) => [...chunk]))).toEqual(new Uint8Array([1, 2, 3]))
      expect(calls[0].headers.get("x-key")).toBe("k")
    }),
  )

  it.effect("streams inline bytes without a request", () =>
    Effect.gen(function* () {
      const chunks = yield* Media.bytes(new Uint8Array([4, 5]), "video/mp4")
        .stream()
        .pipe(Stream.runCollect)
      expect(chunks).toEqual([new Uint8Array([4, 5])])
    }).pipe(Effect.provide(dynamicResponse(() => Effect.die("inline bytes reached the network")))),
  )
})
