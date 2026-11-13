import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Media, VideoClient, ai } from "../src/effect.js"
import { BytePlus, Volcengine } from "../src/providers.js"
import { it } from "./lib/effect.js"
import { dynamicResponse, json, observe, type Call } from "./lib/http.js"

const layer = (handler: Parameters<typeof dynamicResponse>[0]) =>
  VideoClient.layer.pipe(Layer.provideMerge(dynamicResponse(handler)))

const model = Volcengine.configure({ apiKey: "test", baseURL: "https://ark.test/api/v3" }).video(
  "doubao-seedance-2-0-260128",
)
const token = { taskID: "cgt-1" }
const succeeded = {
  id: "cgt-1",
  model: "doubao-seedance-2-0-260128",
  status: "succeeded",
  content: { video_url: "https://ark-content.test/out.mp4" },
  usage: { completion_tokens: 108900, total_tokens: 108900 },
  created_at: 1779348818,
  updated_at: 1779348874,
  seed: 78674,
  resolution: "720p",
  ratio: "16:9",
  duration: 5,
  framespersecond: 24,
  service_tier: "default",
  generate_audio: true,
  draft: false,
}

const reply = (body: unknown) => layer((input) => Effect.succeed(json(input, body)))

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

describe("ai.video.start / Seedance", () => {
  it.effect("maps frames, shared fields and provider options onto Ark's content[] body", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const job = yield* ai.video
        .start({
          model,
          prompt: "The kitten yawns at the camera",
          start: Media.fromDataUrl("data:image/png;base64,AQID"),
          end: "https://example.test/last.png",
          duration: "5 seconds",
          aspect: "16:9",
          resolution: "720p",
          sound: false,
          providerOptions: { watermark: true, return_last_frame: true, future_option: 1 },
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
                return json(input, { id: "cgt-1" })
              }),
            ),
          ),
        )
      expect(job).toEqual({ id: "cgt-1", token: { taskID: "cgt-1" } })
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        "POST https://ark.test/api/v3/contents/generations/tasks?trace=1",
      ])
      expect(JSON.parse(calls[0].body)).toEqual({
        model: "doubao-seedance-2-0-260128",
        content: [
          { type: "text", text: "The kitten yawns at the camera" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AQID" }, role: "first_frame" },
          { type: "image_url", image_url: { url: "https://example.test/last.png" }, role: "last_frame" },
        ],
        duration: 5,
        ratio: "16:9",
        resolution: "720p",
        generate_audio: false,
        watermark: true,
        return_last_frame: true,
        future_option: 1,
      })
    }),
  )

  it.effect("maps image, video and audio references to their roles, with own assets as asset:// URIs", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      yield* ai.video
        .start({
          model,
          prompt: "Match @Image1 to the motion of @Video1",
          references: [
            Media.ref("volcengine", "asset-123"),
            Media.url("https://example.test/style.png", { mediaType: "image/png" }),
            Media.url("https://example.test/motion.mp4", { mediaType: "video/mp4" }),
            Media.url("https://example.test/voice.mp3", { mediaType: "audio/mpeg" }),
          ],
        })
        .pipe(
          Effect.provide(layer((input) => observe(calls, input).pipe(Effect.map(() => json(input, { id: "cgt-2" }))))),
        )
      expect(JSON.parse(calls[0].body)).toEqual({
        model: "doubao-seedance-2-0-260128",
        content: [
          { type: "text", text: "Match @Image1 to the motion of @Video1" },
          { type: "image_url", image_url: { url: "asset://asset-123" }, role: "reference_image" },
          { type: "image_url", image_url: { url: "https://example.test/style.png" }, role: "reference_image" },
          { type: "video_url", video_url: { url: "https://example.test/motion.mp4" }, role: "reference_video" },
          { type: "audio_url", audio_url: { url: "https://example.test/voice.mp3" }, role: "reference_audio" },
        ],
      })
    }),
  )

  it.effect("sends aspect auto as adaptive and leaves unset fields out", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      yield* Effect.gen(function* () {
        yield* ai.video.start({ model, prompt: "x", aspect: "auto" })
        yield* ai.video.start({ model, prompt: "x" })
      }).pipe(
        Effect.provide(layer((input) => observe(calls, input).pipe(Effect.map(() => json(input, { id: "cgt-3" }))))),
      )
      expect(calls.map((call) => JSON.parse(call.body))).toEqual([
        { model: "doubao-seedance-2-0-260128", content: [{ type: "text", text: "x" }], ratio: "adaptive" },
        { model: "doubao-seedance-2-0-260128", content: [{ type: "text", text: "x" }] },
      ])
    }),
  )

  it.effect("sends frames and references together for the provider to judge", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      yield* ai.video
        .start({
          model,
          prompt: "x",
          start: "https://example.test/first.png",
          references: [Media.url("https://example.test/ref.png", { mediaType: "image/png" })],
        })
        .pipe(
          Effect.provide(layer((input) => observe(calls, input).pipe(Effect.map(() => json(input, { id: "cgt-4" }))))),
        )
      expect(JSON.parse(calls[0].body).content.map((item: { role?: string }) => item.role)).toEqual([
        undefined,
        "first_frame",
        "reference_image",
      ])
    }),
  )

  it.effect("adds providerOptions.draft_task as a draft_task content item and omits an empty prompt", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      yield* ai.video
        .start({ model, prompt: "", providerOptions: { draft_task: { id: "cgt-draft" }, resolution: "720p" } })
        .pipe(
          Effect.provide(layer((input) => observe(calls, input).pipe(Effect.map(() => json(input, { id: "cgt-5" }))))),
        )
      expect(JSON.parse(calls[0].body)).toEqual({
        model: "doubao-seedance-2-0-260128",
        content: [{ type: "draft_task", draft_task: { id: "cgt-draft" } }],
        resolution: "720p",
      })
    }),
  )

  it.effect("rejects a reference owned by another provider before sending", () =>
    Effect.gen(function* () {
      const error = yield* ai.video
        .start({ model, prompt: "x", references: [Media.ref("xai", "file_1")] })
        .pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toContain("volcengine references")
    }).pipe(Effect.provide(layer(() => Effect.die("a foreign reference reached the network")))),
  )

  it.effect("uses each provider's Ark host and its own provider ID", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const byteplus = BytePlus.configure({ apiKey: "bp" }).video("dreamina-seedance-2-0-260128")
      const volcengine = Volcengine.configure({ apiKey: "ark" }).video("doubao-seedance-2-0-260128")
      yield* Effect.gen(function* () {
        yield* ai.video.start({ model: byteplus, prompt: "x", references: [Media.ref("byteplus", "a1")] })
        yield* ai.video.start({ model: volcengine, prompt: "x" })
      }).pipe(
        Effect.provide(layer((input) => observe(calls, input).pipe(Effect.map(() => json(input, { id: "cgt-6" }))))),
      )
      expect(byteplus.provider).toBe("byteplus")
      expect(volcengine.provider).toBe("volcengine")
      expect(calls.map((call) => [call.url, call.headers.get("authorization")])).toEqual([
        ["https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks", "Bearer bp"],
        ["https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks", "Bearer ark"],
      ])
      expect(JSON.parse(calls[0].body).content[1].image_url.url).toBe("asset://a1")
    }),
  )
})

// ---------------------------------------------------------------------------
// status, result, cancel
// ---------------------------------------------------------------------------

describe("ai.video.status / result / cancel / Seedance", () => {
  it.effect("reads one status per call from a JSON round-tripped token", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const statuses = yield* Effect.gen(function* () {
        const job = yield* ai.video.start({ model, prompt: "x" })
        const restored: unknown = JSON.parse(JSON.stringify(job.token))
        return yield* Effect.forEach([1, 2, 3], () => ai.video.status(model, restored))
      }).pipe(
        Effect.provide(
          layer((input) =>
            Effect.gen(function* () {
              const { call, nth } = yield* observe(calls, input)
              if (call.method === "POST") return json(input, { id: "cgt-1" })
              if (nth === 1) return json(input, { id: "cgt-1", status: "queued" })
              if (nth === 2) return json(input, { id: "cgt-1", status: "running" })
              return json(input, succeeded)
            }),
          ),
        ),
      )
      expect(statuses).toEqual([{ status: "queued" }, { status: "running" }, { status: "completed" }])
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        "POST https://ark.test/api/v3/contents/generations/tasks",
        "GET https://ark.test/api/v3/contents/generations/tasks/cgt-1",
        "GET https://ark.test/api/v3/contents/generations/tasks/cgt-1",
        "GET https://ark.test/api/v3/contents/generations/tasks/cgt-1",
      ])
    }),
  )

  it.effect("maps every documented status and keeps unknown ones running", () =>
    Effect.gen(function* () {
      const raw = ["queued", "running", "succeeded", "failed", "cancelled", "expired", "paused", "constructor"]
      const statuses = yield* Effect.forEach(raw, (status) =>
        ai.video.status(model, token).pipe(Effect.provide(reply({ id: "cgt-1", status }))),
      )
      expect(statuses.map((value) => value.status)).toEqual([
        "queued",
        "running",
        "completed",
        "failed",
        "cancelled",
        "expired",
        "running",
        "running",
      ])
    }),
  )

  it.effect("returns the video as a URL that expires 24 hours after the task finished, with usage and metadata", () =>
    Effect.gen(function* () {
      const response = yield* ai.video.result(model, token).pipe(Effect.provide(reply(succeeded)))
      expect(response.video.source).toEqual({
        type: "url",
        url: "https://ark-content.test/out.mp4",
        mediaType: "video/mp4",
        expiresAt: (1779348874 + 24 * 60 * 60) * 1000,
      })
      expect(response.video.info).toEqual({ durationSeconds: 5 })
      expect(response.usage).toEqual({ type: "tokens", output: 108900, total: 108900 })
      expect(response.providerMetadata).toEqual({
        volcengine: {
          taskId: "cgt-1",
          model: "doubao-seedance-2-0-260128",
          seed: 78674,
          ratio: "16:9",
          resolution: "720p",
          duration: 5,
          framesPerSecond: 24,
          generateAudio: true,
          draft: false,
          serviceTier: "default",
        },
      })
    }),
  )

  it.effect("derives duration from frames, types mov output and keeps the last frame URL", () =>
    Effect.gen(function* () {
      const response = yield* ai.video.result(model, token).pipe(
        Effect.provide(
          reply({
            status: "succeeded",
            content: {
              video_url: "https://ark-content.test/out.mov",
              last_frame_url: "https://ark-content.test/l.jpg",
            },
            frames: 57,
            framespersecond: 24,
            output_format: "mov",
          }),
        ),
      )
      expect(response.video.mediaType).toBe("video/quicktime")
      expect(response.video.info).toEqual({ durationSeconds: 57 / 24 })
      expect(response.video.expiresAt).toBeGreaterThan(0)
      expect(response.providerMetadata?.volcengine).toMatchObject({
        frames: 57,
        outputFormat: "mov",
        lastFrameUrl: "https://ark-content.test/l.jpg",
      })
    }),
  )

  it.effect("fails a result read before the task finishes", () =>
    Effect.gen(function* () {
      const errors = yield* Effect.forEach(["queued", "running"], (status) =>
        ai.video.result(model, token).pipe(Effect.flip, Effect.provide(reply({ id: "cgt-1", status }))),
      )
      expect(errors.map((error) => error.reason._tag)).toEqual(["InvalidRequest", "InvalidRequest"])
      expect(errors[0].message).toBe(
        "Seedance Video generation cgt-1 has not finished; await it before reading the result",
      )
    }),
  )

  for (const terminal of [
    {
      body: {
        status: "failed",
        error: { code: "InvalidParameter.TaskTypeConstraint", message: "ratio must be adaptive." },
      },
      tag: "InvalidRequest",
      message: "Seedance Video generation failed (InvalidParameter.TaskTypeConstraint): ratio must be adaptive.",
    },
    {
      body: { status: "failed", error: { code: "AuthenticationError", message: "Bad key." } },
      tag: "Authentication",
      message: "Seedance Video generation failed (AuthenticationError): Bad key.",
    },
    {
      body: { status: "failed", error: { code: "QuotaExceeded", message: "Too many queued tasks." } },
      tag: "RateLimit",
      message: "Seedance Video generation failed (QuotaExceeded): Too many queued tasks.",
    },
    {
      body: { status: "failed", error: { code: "InternalServiceError", message: "Retry later." } },
      tag: "ProviderInternal",
      message: "Seedance Video generation failed (InternalServiceError): Retry later.",
    },
    {
      body: { status: "failed", error: { code: "constructor", message: "Future code." } },
      tag: "ProviderInternal",
      message: "Seedance Video generation failed (constructor): Future code.",
    },
    {
      body: {
        status: "failed",
        error: { code: "OutputVideoSensitiveContentDetected", message: "The output video may be sensitive." },
      },
      tag: "ContentPolicy",
      message:
        "Seedance Video generation failed (OutputVideoSensitiveContentDetected): The output video may be sensitive.",
    },
    {
      body: {
        status: "failed",
        error: { code: "InputImageSensitiveContentDetected.PrivacyInformation", message: "Real person." },
      },
      tag: "ContentPolicy",
      message: "Seedance Video generation failed (InputImageSensitiveContentDetected.PrivacyInformation): Real person.",
    },
    { body: { status: "cancelled" }, tag: "InvalidRequest", message: "Seedance Video task cgt-1 was cancelled" },
    { body: { status: "expired" }, tag: "InvalidRequest", message: "Seedance Video task cgt-1 expired" },
    {
      body: { status: "succeeded", content: {} },
      tag: "InvalidProviderOutput",
      message: "Seedance Video completed without a video URL",
    },
  ]) {
    it.effect(`fails the result of ${terminal.body.error?.code ?? terminal.body.status} tasks with the body`, () =>
      Effect.gen(function* () {
        const error = yield* ai.video.result(model, token).pipe(Effect.flip, Effect.provide(reply(terminal.body)))
        expect(error.reason._tag).toBe(terminal.tag)
        expect(error.message).toContain(terminal.message)
        expect(error.reason.body).toBe(JSON.stringify(terminal.body))
      }),
    )
  }

  it.effect("cancels with DELETE on the task and does not retry a refusal", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      yield* ai.video
        .cancel(model, token)
        .pipe(Effect.provide(layer((input) => observe(calls, input).pipe(Effect.map(() => json(input, {}))))))
      const refused = yield* ai.video
        .cancel(model, token)
        .pipe(
          Effect.flip,
          Effect.provide(
            layer((input) =>
              observe(calls, input).pipe(
                Effect.map(() =>
                  json(input, { error: { code: "InvalidParameter", message: "running" } }, { status: 400 }),
                ),
              ),
            ),
          ),
        )
      expect(refused.reason._tag).toBe("InvalidRequest")
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        "DELETE https://ark.test/api/v3/contents/generations/tasks/cgt-1",
        "DELETE https://ark.test/api/v3/contents/generations/tasks/cgt-1",
      ])
    }),
  )

  it.effect("rejects a token from another provider without a request", () =>
    Effect.gen(function* () {
      const error = yield* ai.video.status(model, { requestID: "req_1" }).pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toContain("cannot resume")
    }).pipe(Effect.provide(layer(() => Effect.die("a foreign token reached the network")))),
  )
})
