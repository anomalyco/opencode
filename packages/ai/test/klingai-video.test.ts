import { describe, expect } from "bun:test"
import { Duration, Effect, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { Media, VideoClient, ai } from "../src/effect.js"
import { KlingAI } from "../src/providers.js"
import { it } from "./lib/effect.js"
import { dynamicResponse, json, observe, type Call } from "./lib/http.js"

const layer = (handler: Parameters<typeof dynamicResponse>[0]) =>
  VideoClient.layer.pipe(Layer.provideMerge(dynamicResponse(handler)))

const kling = KlingAI.configure({ apiKey: "test", baseURL: "https://kling.test" })
const model = kling.video("kling-3.0")
const started = { code: 0, message: "SUCCEED", data: { id: "task_1", status: "submitted", create_time: 1000 } }
const DAY = Duration.toMillis(Duration.days(1))

const tasks = (...data: ReadonlyArray<Record<string, unknown>>) => ({ code: 0, message: "SUCCEED", data })

// Records every request, answers starts with `started`, and returns the sent JSON bodies by URL.
const capture = (run: Effect.Effect<unknown, unknown, VideoClient.Service>) =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    yield* run.pipe(
      Effect.provide(layer((input) => observe(calls, input).pipe(Effect.map(() => json(input, started))))),
    )
    return calls.map((call) => ({ url: call.url, body: JSON.parse(call.body) }))
  })

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

describe("ai.video.start / Kling", () => {
  it.effect("maps a text-only request onto the text-to-video endpoint and returns the job without polling", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const job = yield* ai.video
        .start({
          model,
          prompt: "A paper boat on a stream",
          duration: "5 seconds",
          aspect: "9:16",
          resolution: "4k",
          sound: true,
          providerOptions: {
            settings: { multi_shot: false },
            options: { external_task_id: "mine", watermark_info: { enabled: true } },
          },
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
                return json(input, started)
              }),
            ),
          ),
        )
      expect(job).toEqual({ id: "task_1", token: { taskID: "task_1", createdAt: 1000 } })
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        "POST https://kling.test/text-to-video/kling-3.0?trace=1",
      ])
      expect(JSON.parse(calls[0].body)).toEqual({
        prompt: "A paper boat on a stream",
        settings: { duration: 5, aspect_ratio: "9:16", resolution: "4k", audio: "native", multi_shot: false },
        options: { external_task_id: "mine", watermark_info: { enabled: true } },
      })
    }),
  )

  it.effect("sends start and end frames to image-to-video, inline images as bare base64", () =>
    Effect.gen(function* () {
      const sent = yield* capture(
        ai.video.start({
          model,
          prompt: "Bloom",
          start: Media.fromDataUrl("data:image/png;base64,AQID"),
          end: "https://example.test/last.png",
          aspect: "auto",
          sound: false,
        }),
      )
      expect(sent).toEqual([
        {
          url: "https://kling.test/image-to-video/kling-3.0",
          body: {
            contents: [
              { type: "prompt", text: "Bloom" },
              { type: "first_frame", url: "AQID" },
              { type: "last_frame", url: "https://example.test/last.png" },
            ],
            settings: { audio: "off" },
          },
        },
      ])
    }),
  )

  it.effect("sends references with frames to the Omni endpoint, first frame first and last frame last", () =>
    Effect.gen(function* () {
      const sent = yield* capture(
        ai.video.start({
          model: kling.video("kling-4.0"),
          prompt: "@image_1 walks through @video_1",
          start: "https://example.test/first.png",
          end: "https://example.test/last.png",
          references: [
            "https://example.test/style.png",
            Media.url("https://example.test/motion.mp4", { mediaType: "video/mp4" }),
            Media.fromDataUrl("data:image/png;base64,BAUG"),
          ],
          aspect: "auto",
        }),
      )
      expect(sent).toEqual([
        {
          url: "https://kling.test/omni-video/kling-4.0",
          body: {
            contents: [
              { type: "prompt", text: "@image_1 walks through @video_1" },
              { type: "first_frame", url: "https://example.test/first.png" },
              { type: "refer_image", url: "https://example.test/style.png", id: "image_1" },
              { type: "refer_image", url: "BAUG", id: "image_2" },
              { type: "feature_video", url: "https://example.test/motion.mp4", id: "video_1" },
              { type: "last_frame", url: "https://example.test/last.png" },
            ],
            settings: { aspect_ratio: "adaptive" },
          },
        },
      ])
    }),
  )

  it.effect("routes Omni-only models to omni-video and models.dev names to Kling's path segments", () =>
    Effect.gen(function* () {
      const sent = yield* capture(
        Effect.gen(function* () {
          yield* ai.video.start({ model: kling.video("kling-video-o1"), prompt: "x" })
          yield* ai.video.start({ model: kling.video("kling-3.0-omni"), prompt: "x" })
          yield* ai.video.start({ model: kling.video("kling-v2-6"), prompt: "x" })
          yield* ai.video.start({ model: kling.video("kling-v2-5-turbo"), prompt: "x", start: "https://e.test/a.png" })
          yield* ai.video.start({ model: kling.video("kling-4.0-flash"), prompt: "x" })
          yield* ai.video.start({
            model: kling.video("kling-future"),
            prompt: "x",
            references: ["https://e.test/a.png"],
          })
        }),
      )
      expect(sent.map((call) => call.url)).toEqual([
        "https://kling.test/omni-video/kling-o1",
        "https://kling.test/omni-video/kling-3.0-omni",
        "https://kling.test/text-to-video/kling-2.6",
        "https://kling.test/image-to-video/kling-2.5-turbo",
        "https://kling.test/text-to-video/kling-4.0-flash",
        "https://kling.test/omni-video/kling-future",
      ])
      expect(sent[0].body).toEqual({ contents: [{ type: "prompt", text: "x" }] })
      expect(sent[2].body).toEqual({ prompt: "x" })
    }),
  )

  it.effect("takes an explicit endpoint, native contents before the last frame, and native settings overrides", () =>
    Effect.gen(function* () {
      const sent = yield* capture(
        ai.video.start({
          model: kling.video("kling-4.0"),
          prompt: "@element_1 waves",
          end: "https://example.test/last.png",
          sound: true,
          providerOptions: {
            endpoint: "omni-video",
            contents: [{ type: "element", element_id: "el_1", id: "element_1" }],
            settings: { audio: "original" },
          },
        }),
      )
      expect(sent).toEqual([
        {
          url: "https://kling.test/omni-video/kling-4.0",
          body: {
            contents: [
              { type: "prompt", text: "@element_1 waves" },
              { type: "element", element_id: "el_1", id: "element_1" },
              { type: "last_frame", url: "https://example.test/last.png" },
            ],
            settings: { audio: "original" },
          },
        },
      ])
    }),
  )

  for (const rejected of [
    {
      name: "reference audio, which Kling takes as voice ids only",
      request: { model, references: [Media.url("https://e.test/v.mp3", { mediaType: "audio/mpeg" })] },
      message: "reference audio",
    },
    {
      name: "references on a model without an Omni endpoint",
      request: { model, references: ["https://e.test/a.png"] },
      message: "has no reference input",
    },
    {
      name: "inline reference videos, which Kling takes by URL only",
      request: {
        model: kling.video("kling-4.0"),
        references: [Media.bytes(new Uint8Array([1]), "video/mp4")],
      },
      message: "by URL only",
    },
    {
      name: "frames sent to an explicit text-to-video endpoint",
      request: { model, start: "https://e.test/a.png", providerOptions: { endpoint: "text-to-video" as const } },
      message: "no start or end frame",
    },
    {
      name: "native contents sent to an explicit text-to-video endpoint",
      request: {
        model,
        providerOptions: {
          endpoint: "text-to-video" as const,
          contents: [{ type: "element", element_id: "el_1", id: "element_1" }],
        },
      },
      message: "no contents input",
    },
  ])
    it.effect(`rejects ${rejected.name} before sending`, () =>
      Effect.gen(function* () {
        const error = yield* ai.video.start({ prompt: "x", ...rejected.request }).pipe(Effect.flip)
        expect(error.reason._tag).toBe("UnsupportedOperation")
        expect(error.message).toContain(rejected.message)
      }).pipe(Effect.provide(layer(() => Effect.die("an unsupported request reached the network")))),
    )

  it.effect("returns Kling's request errors typed without retrying", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const error = yield* ai.video
        .start({ model, prompt: "x", duration: "99 seconds" })
        .pipe(
          Effect.flip,
          Effect.provide(
            layer((input) =>
              observe(calls, input).pipe(
                Effect.map(() => json(input, { code: 1201, message: "duration is invalid" }, { status: 400 })),
              ),
            ),
          ),
        )
      expect(error.reason._tag).toBe("InvalidRequest")
      expect(calls).toHaveLength(1)
    }),
  )
})

// ---------------------------------------------------------------------------
// status, result, cancel
// ---------------------------------------------------------------------------

const token = { taskID: "task_1", createdAt: 1000 }

const succeeded = {
  id: "task_1",
  status: "succeeded",
  message: "",
  create_time: 1000,
  external_id: "mine",
  outputs: [
    {
      type: "video",
      id: "video_9",
      url: "https://cdn.kling.test/out.mp4",
      watermark_url: "https://cdn.kling.test/out-wm.mp4",
      duration: "5.041",
    },
  ],
  usage: { output_duration: "5" },
  billing: [{ charge_type: "cash", amount: "0.42", currency: "USD" }],
}

describe("ai.video.status / result / cancel / Kling", () => {
  it.effect("reads one status per call from a JSON round-tripped token", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const statuses = yield* Effect.gen(function* () {
        const job = yield* ai.video.start({ model, prompt: "x" })
        const stored: unknown = JSON.parse(JSON.stringify(job.token))
        return yield* Effect.forEach([1, 2, 3, 4, 5, 6], () => ai.video.status(model, stored))
      }).pipe(
        Effect.provide(
          layer((input) =>
            Effect.gen(function* () {
              const { call, nth } = yield* observe(calls, input)
              if (call.method === "POST") return json(input, started)
              const status = ["submitted", "processing", "succeeded", "failed", "warming_up", "constructor"][nth - 1]
              return json(input, tasks({ id: "task_1", status }))
            }),
          ),
        ),
      )
      expect(statuses.map((value) => value.status)).toEqual([
        "queued",
        "running",
        "completed",
        "failed",
        "running",
        "running",
      ])
      expect(calls.slice(0, 2).map((call) => `${call.method} ${call.url}`)).toEqual([
        "POST https://kling.test/text-to-video/kling-3.0",
        "GET https://kling.test/tasks?task_ids=task_1",
      ])
    }),
  )

  it.effect("returns the finished video as a URL that expires 30 days after the task was created", () =>
    Effect.gen(function* () {
      const response = yield* ai.video.result(model, token)
      expect(response.videos).toHaveLength(1)
      expect(response.video.source).toEqual({
        type: "url",
        url: "https://cdn.kling.test/out.mp4",
        mediaType: "video/mp4",
        expiresAt: 1000 + 30 * DAY,
      })
      expect(response.video.info).toEqual({ durationSeconds: 5.041 })
      expect(response.video.providerMetadata).toEqual({
        klingai: { id: "video_9", watermarkUrl: "https://cdn.kling.test/out-wm.mp4" },
      })
      expect(response.usage).toEqual({ type: "seconds", seconds: 5 })
      expect(response.providerMetadata).toEqual({
        klingai: {
          taskId: "task_1",
          externalTaskId: "mine",
          billing: [{ charge_type: "cash", amount: "0.42", currency: "USD" }],
        },
      })
    }).pipe(Effect.provide(layer((input) => Effect.succeed(json(input, tasks(succeeded)))))),
  )

  it.effect("starts the 30 days from the read when neither the task nor the token has a creation time", () =>
    Effect.gen(function* () {
      yield* TestClock.adjust("1 day")
      const response = yield* ai.video.result(model, { taskID: "task_1" })
      expect(response.video.source).toMatchObject({ expiresAt: 31 * DAY })
    }).pipe(
      Effect.provide(layer((input) => Effect.succeed(json(input, tasks({ ...succeeded, create_time: undefined }))))),
    ),
  )

  it.effect("fails a result read before the job finishes", () =>
    Effect.gen(function* () {
      const error = yield* ai.video.result(model, token).pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toBe("Kling Video generation task_1 has not finished; await it before reading the result")
    }).pipe(
      Effect.provide(layer((input) => Effect.succeed(json(input, tasks({ id: "task_1", status: "processing" }))))),
    ),
  )

  it.effect("fails a failed job with Kling's message and the provider body", () =>
    Effect.gen(function* () {
      const body = tasks({ id: "task_1", status: "failed", message: "Failure to pass the risk control system" })
      const error = yield* ai.video
        .result(model, token)
        .pipe(Effect.flip, Effect.provide(layer((input) => Effect.succeed(json(input, body)))))
      expect(error.reason._tag).toBe("ProviderInternal")
      expect(error.message).toBe("Kling Video generation failed: Failure to pass the risk control system")
      expect(error.reason.body).toBe(JSON.stringify(body))
    }),
  )

  it.effect("fails a succeeded job without a video URL as invalid output", () =>
    Effect.gen(function* () {
      const error = yield* ai.video.result(model, token).pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidProviderOutput")
      expect(error.message).toContain("without a video URL")
    }).pipe(
      Effect.provide(
        layer((input) => Effect.succeed(json(input, tasks({ id: "task_1", status: "succeeded", outputs: [] })))),
      ),
    ),
  )

  it.effect("reports a task Kling no longer has as expired only once its retention has passed", () =>
    Effect.gen(function* () {
      const read = Effect.all([
        ai.video.status(model, token).pipe(Effect.flip),
        ai.video.result(model, token).pipe(Effect.flip),
      ])
      const [statusEarly, resultEarly] = yield* read
      expect(statusEarly.reason._tag).toBe("InvalidProviderOutput")
      expect(resultEarly.reason._tag).toBe("InvalidProviderOutput")
      expect(resultEarly.message).toBe("Kling Video returned no task task_1")

      yield* TestClock.adjust("31 days")
      expect(yield* ai.video.status(model, token)).toEqual({ status: "expired" })
      const expired = yield* ai.video.result(model, token).pipe(Effect.flip)
      expect(expired.reason._tag).toBe("InvalidRequest")
      expect(expired.message).toBe("Kling Video task task_1 expired")
    }).pipe(Effect.provide(layer((input) => Effect.succeed(json(input, tasks()))))),
  )

  it.effect("fails cancel as unsupported without sending a request, since Kling has no cancel endpoint", () =>
    Effect.gen(function* () {
      const error = yield* ai.video.cancel(model, token).pipe(Effect.flip)
      expect(error.reason._tag).toBe("UnsupportedOperation")
      expect(error.message).toContain("cancel")
    }).pipe(Effect.provide(layer(() => Effect.die("cancel reached the network")))),
  )
})
