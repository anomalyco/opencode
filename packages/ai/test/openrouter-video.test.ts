import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Media, VideoClient, ai } from "../src/effect.js"
import { OpenRouter } from "../src/providers.js"
import { it } from "./lib/effect.js"
import { dynamicResponse, json, observe, type Call, type HandlerInput } from "./lib/http.js"

const layer = (handler: Parameters<typeof dynamicResponse>[0]) =>
  VideoClient.layer.pipe(Layer.provideMerge(dynamicResponse(handler)))

const openrouter = OpenRouter.configure({ apiKey: "test", baseURL: "https://openrouter.test/api/v1" })
const model = openrouter.video("x-ai/grok-imagine-video-1.5-lite")
const id = "gen-vid-1-abc"
const started = (input: HandlerInput) =>
  json(input, {
    id: "gen-vid-1-abc",
    polling_url: "https://openrouter.test/api/v1/videos/gen-vid-1-abc",
    status: "pending",
  })
const completed = {
  id: "gen-vid-1-abc",
  generation_id: "gen-vid-1-abc",
  status: "completed",
  unsigned_urls: ["https://openrouter.test/api/v1/videos/gen-vid-1-abc/content?index=0"],
  usage: { cost: 0.03, is_byok: false },
  expires_at: 1794633487,
}

const record = (calls: Array<Call>) => layer((input) => observe(calls, input).pipe(Effect.map(() => started(input))))

describe("ai.video.start / OpenRouter", () => {
  it.effect("maps the request onto OpenRouter's body and returns the job without polling", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const job = yield* ai.video
        .start({
          model,
          prompt: "A red balloon floats up",
          start: Media.image(Media.fromDataUrl("data:image/png;base64,AQID")),
          end: "https://example.test/last.png",
          duration: "6 seconds",
          aspect: "16:9",
          resolution: "4k",
          sound: false,
          providerOptions: {
            provider: { only: ["seed"], options: { seed: { watermark: false } } },
            seed: 7,
          },
        })
        .pipe(Effect.provide(record(calls)))
      expect(job).toEqual({ id: "gen-vid-1-abc" })
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(["POST https://openrouter.test/api/v1/videos"])
      expect(calls[0].headers.get("authorization")).toBe("Bearer test")
      expect(JSON.parse(calls[0].body)).toEqual({
        model: "x-ai/grok-imagine-video-1.5-lite",
        prompt: "A red balloon floats up",
        frame_images: [
          { type: "image_url", image_url: { url: "data:image/png;base64,AQID" }, frame_type: "first_frame" },
          { type: "image_url", image_url: { url: "https://example.test/last.png" }, frame_type: "last_frame" },
        ],
        duration: 6,
        aspect_ratio: "16:9",
        resolution: "4K",
        generate_audio: false,
        provider: { only: ["seed"], options: { seed: { watermark: false } } },
        seed: 7,
      })
    }),
  )

  it.effect("sends image, video and audio references by kind and leaves aspect out for auto", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      yield* ai.video
        .start({
          model,
          prompt: "x",
          aspect: "auto",
          references: [
            Media.fromDataUrl("data:image/png;base64,AQID"),
            Media.url("https://example.test/motion.mp4", { mediaType: "video/mp4" }),
            Media.url("https://example.test/voice.mp3", { mediaType: "audio/mpeg" }),
          ],
        })
        .pipe(Effect.provide(record(calls)))
      expect(JSON.parse(calls[0].body)).toEqual({
        model: "x-ai/grok-imagine-video-1.5-lite",
        prompt: "x",
        input_references: [
          { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
          { type: "video_url", video_url: { url: "https://example.test/motion.mp4" } },
          { type: "audio_url", audio_url: { url: "https://example.test/voice.mp3" } },
        ],
      })
    }),
  )

  it.effect("sends a start frame and references together", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      yield* ai.video
        .start({
          model,
          prompt: "x",
          start: "https://example.test/first.png",
          references: ["https://example.test/style.png"],
        })
        .pipe(Effect.provide(record(calls)))
      expect(JSON.parse(calls[0].body)).toEqual({
        model: "x-ai/grok-imagine-video-1.5-lite",
        prompt: "x",
        frame_images: [
          { type: "image_url", image_url: { url: "https://example.test/first.png" }, frame_type: "first_frame" },
        ],
        input_references: [{ type: "image_url", image_url: { url: "https://example.test/style.png" } }],
      })
    }),
  )

  it.effect("passes a previous job through to edit or extend it", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      yield* ai.video
        .start({ model, prompt: "keep going", providerOptions: { previous_job_id: "gen-vid-1-prev" } })
        .pipe(Effect.provide(record(calls)))
      expect(JSON.parse(calls[0].body)).toMatchObject({ previous_job_id: "gen-vid-1-prev" })
    }),
  )

  it.effect("rejects what OpenRouter can't use before sending", () =>
    Effect.gen(function* () {
      const inline = yield* ai.video
        .start({ model, prompt: "x", references: [Media.bytes(Uint8Array.from([0, 0, 0]), "video/mp4")] })
        .pipe(Effect.flip)
      expect(inline.reason._tag).toBe("UnsupportedOperation")
      expect(inline.message).toContain("only takes reference video as http(s) URLs")

      const audio = yield* ai.video
        .start({ model, prompt: "x", references: [Media.bytes(Uint8Array.from([0x49, 0x44, 0x33]), "audio/mpeg")] })
        .pipe(Effect.flip)
      expect(audio.reason._tag).toBe("UnsupportedOperation")
      expect(audio.message).toContain("only takes reference audio as http(s) URLs")
    }).pipe(Effect.provide(layer(() => Effect.die("an unsupported request reached the network")))),
  )
})

describe("ai.video.status / result / cancel / OpenRouter", () => {
  it.effect("maps OpenRouter statuses, keeping unknown ones running", () =>
    Effect.gen(function* () {
      const statuses = yield* Effect.forEach(
        ["pending", "in_progress", "completed", "failed", "cancelled", "expired", "warming_up"],
        (status) =>
          ai.video
            .status(model, id)
            .pipe(Effect.provide(layer((input) => Effect.succeed(json(input, { id, status }))))),
      )
      expect(statuses.map((value) => value.status)).toEqual([
        "queued",
        "running",
        "completed",
        "failed",
        "cancelled",
        "expired",
        "running",
      ])
    }),
  )

  it.effect("returns the content URL with the API key to download it, its expiry and the cost", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const response = yield* Effect.gen(function* () {
        const result = yield* ai.video.result(model, id)
        expect(yield* result.video.bytes()).toEqual(Uint8Array.from([1, 2, 3]))
        return result
      }).pipe(
        Effect.provide(
          layer((input) =>
            Effect.gen(function* () {
              const { call } = yield* observe(calls, input)
              if (call.url.endsWith("/content?index=0"))
                return input.respond(Uint8Array.from([1, 2, 3]), { headers: { "content-type": "video/mp4" } })
              return json(input, completed)
            }),
          ),
        ),
      )
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        "GET https://openrouter.test/api/v1/videos/gen-vid-1-abc",
        "GET https://openrouter.test/api/v1/videos/gen-vid-1-abc/content?index=0",
      ])
      expect(calls[1].headers.get("authorization")).toBe("Bearer test")
      expect(response.video.source).toEqual({
        type: "url",
        url: "https://openrouter.test/api/v1/videos/gen-vid-1-abc/content?index=0",
        mediaType: "video/mp4",
        expiresAt: 1794633487000,
      })
      expect(response.providerMetadata).toEqual({
        openrouter: { id: "gen-vid-1-abc", generationId: "gen-vid-1-abc", cost: 0.03, isByok: false },
      })
    }),
  )

  it.effect("attaches no credentials to a result URL on another host", () =>
    Effect.gen(function* () {
      const response = yield* ai.video.result(model, id)
      expect(response.video.headers).toEqual({})
    }).pipe(
      Effect.provide(
        layer((input) =>
          Effect.succeed(json(input, { ...completed, unsigned_urls: ["https://cdn.example.test/video.mp4"] })),
        ),
      ),
    ),
  )

  it.effect("fails a result read before the job finishes", () =>
    Effect.gen(function* () {
      const error = yield* ai.video.result(model, id).pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toContain("has not finished")
    }).pipe(Effect.provide(layer((input) => Effect.succeed(json(input, { id, status: "in_progress" }))))),
  )

  for (const terminal of [
    {
      body: { status: "failed", error: "Upstream timed out" },
      tag: "ProviderInternal",
      message: "OpenRouter Video generation failed: Upstream timed out",
    },
    {
      body: { status: "failed", error: "Content policy violation" },
      tag: "ContentPolicy",
      message: "OpenRouter Video generation failed: Content policy violation",
    },
    {
      body: { status: "expired", error: "Job exceeded maximum time to live" },
      tag: "InvalidRequest",
      message: "OpenRouter Video job gen-vid-1-abc expired: Job exceeded maximum time to live",
    },
    {
      body: { status: "cancelled", error: "Job was cancelled" },
      tag: "InvalidRequest",
      message: "OpenRouter Video job gen-vid-1-abc cancelled: Job was cancelled",
    },
  ]) {
    it.effect(`fails the result of a job that ${terminal.body.status} with "${terminal.body.error}"`, () =>
      Effect.gen(function* () {
        const error = yield* ai.video.result(model, id).pipe(Effect.flip)
        expect(error.reason._tag).toBe(terminal.tag)
        expect(error.message).toBe(terminal.message)
      }).pipe(Effect.provide(layer((input) => Effect.succeed(json(input, { id, ...terminal.body }))))),
    )
  }

  it.effect("fails cancel as unsupported without a request, since OpenRouter has no cancel endpoint", () =>
    Effect.gen(function* () {
      const error = yield* ai.video.cancel(model, id).pipe(Effect.flip)
      expect(error.reason._tag).toBe("UnsupportedOperation")
    }).pipe(Effect.provide(layer(() => Effect.die("cancel reached the network")))),
  )
})
