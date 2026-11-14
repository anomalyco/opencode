import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Media, VideoClient, ai } from "../src/effect.js"
import { MiniMax } from "../src/providers.js"
import { it } from "./lib/effect.js"
import { dynamicResponse, json, observe, type Call } from "./lib/http.js"

const layer = (handler: Parameters<typeof dynamicResponse>[0]) =>
  VideoClient.layer.pipe(Layer.provideMerge(dynamicResponse(handler)))

const minimax = MiniMax.configure({ apiKey: "test", baseURL: "https://minimax.test" })
const h3 = minimax.video("MiniMax-H3-Lite")
const hailuo = minimax.video("MiniMax-Hailuo-02")
const id = "task_1"

const task = (fields: Record<string, unknown>) => ({ task: { id: "task_1", model: "MiniMax-H3-Lite", ...fields } })
const succeeded = task({
  status: "succeeded",
  content: { url: "https://cdn.minimax.test/out.mp4" },
  resolution: "480P",
  duration: 4,
  ratio: "16:9",
  usage: { total_seconds: 4, output_seconds: 4, input_image_count: 0 },
})

const hailuoTask = (fields: Record<string, unknown>) => ({
  task_id: "task_1",
  base_resp: { status_code: 0, status_msg: "success" },
  ...fields,
})

/** The calls and parsed bodies MiniMax receives for each submitted request. */
const sent = (requests: ReadonlyArray<Omit<Parameters<typeof ai.video.start>[0], "prompt">>) =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    yield* Effect.forEach(requests, (request) => ai.video.start({ prompt: "test", ...request })).pipe(
      Effect.provide(
        layer((input) =>
          observe(calls, input).pipe(
            Effect.map(() => json(input, { task_id: "task_1", base_resp: { status_code: 0, status_msg: "success" } })),
          ),
        ),
      ),
    )
    return calls.map((call) => ({ url: call.url, body: JSON.parse(call.body) }))
  })

// ---------------------------------------------------------------------------
// H3 (v2) start
// ---------------------------------------------------------------------------

describe("MiniMax Video / H3 start", () => {
  it.effect("maps every shared field onto the v2 content array and returns the job without polling", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const job = yield* ai.video
        .start({
          model: h3,
          prompt: "Make the water crash down",
          references: [
            Media.fromDataUrl("data:image/png;base64,AQID"),
            Media.url("https://example.test/motion.mp4", { mediaType: "video/mp4" }),
            Media.url("https://example.test/voice.mp3", { mediaType: "audio/mpeg" }),
            Media.ref("minimax", "file_1"),
          ],
          duration: "6 seconds",
          aspect: "16:9",
          resolution: "768p",
          sound: true,
          providerOptions: { extra: { prompt_expansion_mode: "disabled" }, future_option: true },
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
                return json(input, { task_id: "task_1" })
              }),
            ),
          ),
        )
      expect(job).toEqual({ id: "task_1" })
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        "POST https://minimax.test/v2/video_generation?trace=1",
      ])
      expect(JSON.parse(calls[0].body)).toEqual({
        model: "MiniMax-H3-Lite",
        content: [
          { type: "text", text: "Make the water crash down" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AQID" }, role: "reference_image" },
          { type: "video_url", video_url: { url: "https://example.test/motion.mp4" }, role: "reference_video" },
          { type: "audio_url", audio_url: { url: "https://example.test/voice.mp3" }, role: "reference_audio" },
          { type: "image_url", image_url: { url: "mm_file://file_1" }, role: "reference_image" },
        ],
        duration: 6,
        ratio: "16:9",
        resolution: "768P",
        extra: { prompt_expansion_mode: "disabled" },
        future_option: true,
      })
    }),
  )

  it.effect("sends first and last frames by role and maps auto to adaptive", () =>
    Effect.gen(function* () {
      const requests = yield* sent([
        {
          model: h3,
          start: "https://example.test/first.png",
          end: "https://example.test/last.png",
          aspect: "auto",
          resolution: "2k",
        },
      ])
      expect(requests[0].body).toEqual({
        model: "MiniMax-H3-Lite",
        content: [
          { type: "text", text: "test" },
          { type: "image_url", image_url: { url: "https://example.test/first.png" }, role: "first_frame" },
          { type: "image_url", image_url: { url: "https://example.test/last.png" }, role: "last_frame" },
        ],
        ratio: "adaptive",
        resolution: "2K",
      })
    }),
  )

  it.effect("leaves resolution, duration and ratio unset for MiniMax to require", () =>
    Effect.gen(function* () {
      const requests = yield* sent([{ model: h3 }])
      expect(requests[0].body).toEqual({ model: "MiniMax-H3-Lite", content: [{ type: "text", text: "test" }] })
    }),
  )

  it.effect("sends nothing for sound, which neither API has a field for", () =>
    Effect.gen(function* () {
      const requests = yield* sent([
        { model: h3, sound: false },
        { model: h3, sound: true },
        { model: hailuo, sound: true },
      ])
      expect(requests.map((request) => "generate_audio" in request.body || "sound" in request.body)).toEqual([
        false,
        false,
        false,
      ])
    }),
  )

  it.effect("returns MiniMax's HTTP errors typed", () =>
    Effect.gen(function* () {
      const body = {
        type: "error",
        error: {
          type: "bad_request_error",
          message: "invalid params, ratio is required for t2va (text-only) and cannot be 'adaptive' (2013)",
          http_code: "400",
        },
      }
      const error = yield* ai.video
        .start({ model: h3, prompt: "x", resolution: "480p", duration: "4 seconds" })
        .pipe(Effect.flip, Effect.provide(layer((input) => Effect.succeed(json(input, body, { status: 400 })))))
      expect(error.reason._tag).toBe("InvalidRequest")
    }),
  )
})

// ---------------------------------------------------------------------------
// Hailuo (v1) start
// ---------------------------------------------------------------------------

describe("MiniMax Video / Hailuo start", () => {
  it.effect("routes Hailuo and 01-series models to the v1 API and H3 to v2", () =>
    Effect.gen(function* () {
      const requests = yield* sent(
        ["MiniMax-Hailuo-2.3", "MiniMax-Hailuo-2.3-Fast", "I2V-01-live", "S2V-01", "MiniMax-H3", "MiniMax-H4"].map(
          (id) => ({ model: minimax.video(id) }),
        ),
      )
      expect(requests.map((request) => request.url)).toEqual([
        "https://minimax.test/v1/video_generation",
        "https://minimax.test/v1/video_generation",
        "https://minimax.test/v1/video_generation",
        "https://minimax.test/v1/video_generation",
        "https://minimax.test/v2/video_generation",
        "https://minimax.test/v2/video_generation",
      ])
    }),
  )

  it.effect("drops the version from a baseURL shared with the other MiniMax APIs", () =>
    Effect.gen(function* () {
      const requests = yield* sent(
        ["https://api.minimax.cn/v1", "https://api.minimax.cn/v1/", "https://api.minimax.cn/"].flatMap((baseURL) => {
          const shared = MiniMax.configure({ apiKey: "test", baseURL })
          return [{ model: shared.video("MiniMax-H3") }, { model: shared.video("MiniMax-Hailuo-2.3") }]
        }),
      )
      expect(requests.map((request) => request.url)).toEqual(
        Array.from({ length: 3 }).flatMap(() => [
          "https://api.minimax.cn/v2/video_generation",
          "https://api.minimax.cn/v1/video_generation",
        ]),
      )
    }),
  )

  it.effect("maps the shared fields onto v1's flat body", () =>
    Effect.gen(function* () {
      const requests = yield* sent([
        {
          model: hailuo,
          start: Media.image(Media.fromDataUrl("data:image/png;base64,AQID")),
          end: "https://example.test/last.png",
          references: ["https://example.test/face.png"],
          duration: "10 seconds",
          aspect: "auto",
          resolution: "768p",
          sound: false,
          providerOptions: { prompt_optimizer: false, fast_pretreatment: true },
        },
      ])
      expect(requests[0].body).toEqual({
        model: "MiniMax-Hailuo-02",
        prompt: "test",
        first_frame_image: "data:image/png;base64,AQID",
        last_frame_image: "https://example.test/last.png",
        subject_reference: [{ type: "character", image: ["https://example.test/face.png"] }],
        duration: 10,
        resolution: "768P",
        prompt_optimizer: false,
        fast_pretreatment: true,
      })
    }),
  )

  for (const rejected of [
    {
      name: "a reference video",
      request: { references: [Media.url("https://example.test/m.mp4", { mediaType: "video/mp4" })] },
      tag: "UnsupportedOperation",
    },
    {
      name: "reference audio",
      request: { references: [Media.url("https://example.test/v.mp3", { mediaType: "audio/mpeg" })] },
      tag: "UnsupportedOperation",
    },
    { name: "an aspect ratio", request: { aspect: "16:9" as const }, tag: "UnsupportedOperation" },
    { name: "a MiniMax file reference", request: { start: Media.ref("minimax", "file_1") }, tag: "InvalidRequest" },
  ]) {
    it.effect(`rejects ${rejected.name}, which v1 has no field for, before sending`, () =>
      Effect.gen(function* () {
        const error = yield* ai.video.start({ model: hailuo, prompt: "x", ...rejected.request }).pipe(Effect.flip)
        expect(error.reason._tag).toBe(rejected.tag)
      }).pipe(Effect.provide(layer(() => Effect.die("an unsupported request reached the network")))),
    )
  }

  it.effect("fails a submit that v1 answers with a non-zero base_resp", () =>
    Effect.gen(function* () {
      const body = {
        task_id: "",
        base_resp: { status_code: 2013, status_msg: "invalid params, model does not support Text-to-Video mode" },
      }
      const error = yield* ai.video
        .start({ model: hailuo, prompt: "x" })
        .pipe(Effect.flip, Effect.provide(layer((input) => Effect.succeed(json(input, body)))))
      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toBe(
        "MiniMax Hailuo Video generation failed (2013): invalid params, model does not support Text-to-Video mode",
      )
      expect(error.reason.body).toBe(JSON.stringify(body))
    }),
  )
})

// ---------------------------------------------------------------------------
// H3 status, result, cancel
// ---------------------------------------------------------------------------

describe("MiniMax Video / H3 status, result and cancel", () => {
  it.effect("reads statuses from a JSON round-tripped token and keeps unknown ones running", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const raw: unknown = id
      const statuses = yield* Effect.forEach(
        ["queued", "running", "succeeded", "failed", "cancelled", "warming_up", "constructor"],
        (status) =>
          ai.video
            .status(h3, raw)
            .pipe(
              Effect.provide(
                layer((input) => observe(calls, input).pipe(Effect.map(() => json(input, task({ status }))))),
              ),
            ),
      )
      expect(statuses.map((value) => value.status)).toEqual([
        "queued",
        "running",
        "completed",
        "failed",
        "cancelled",
        "running",
        "running",
      ])
      expect(calls[0].url).toBe("https://minimax.test/v2/query/video_generation/task_1")
    }),
  )

  it.effect("returns the finished video with duration, usage and metadata", () =>
    Effect.gen(function* () {
      const response = yield* ai.video.result(h3, id)
      expect(response.video.source).toEqual({
        type: "url",
        url: "https://cdn.minimax.test/out.mp4",
        mediaType: "video/mp4",
      })
      expect(response.video.info).toEqual({ durationSeconds: 4 })
      expect(response.usage).toEqual({ type: "seconds", seconds: 4 })
      expect(response.providerMetadata).toEqual({
        minimax: {
          taskId: "task_1",
          model: "MiniMax-H3-Lite",
          resolution: "480P",
          ratio: "16:9",
          usage: { total_seconds: 4, output_seconds: 4, input_image_count: 0 },
        },
      })
    }).pipe(Effect.provide(layer((input) => Effect.succeed(json(input, succeeded))))),
  )

  it.effect("reads the flat response format too", () =>
    Effect.gen(function* () {
      const response = yield* ai.video.result(h3, id)
      expect(response.video.source).toMatchObject({ url: "https://cdn.minimax.test/out.mp4" })
    }).pipe(Effect.provide(layer((input) => Effect.succeed(json(input, succeeded.task))))),
  )

  it.effect("fails a result read before the task finishes", () =>
    Effect.gen(function* () {
      const error = yield* ai.video.result(h3, id).pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toContain("has not finished")
    }).pipe(Effect.provide(layer((input) => Effect.succeed(json(input, task({ status: "running" })))))),
  )

  for (const terminal of [
    {
      body: task({
        status: "failed",
        error: { code: "1026", message: "video description contains sensitive content" },
      }),
      tag: "ContentPolicy",
      message: "MiniMax Video generation failed (1026): video description contains sensitive content",
    },
    {
      body: task({ status: "failed", error: { code: "1027", message: "output contains sensitive content" } }),
      tag: "ContentPolicy",
      message: "MiniMax Video generation failed (1027): output contains sensitive content",
    },
    {
      body: task({ status: "failed", error: { code: "2013", message: "invalid params" } }),
      tag: "InvalidRequest",
      message: "MiniMax Video generation failed (2013): invalid params",
    },
    {
      body: task({ status: "failed", error: { code: "1008", message: "insufficient balance" } }),
      tag: "QuotaExceeded",
      message: "MiniMax Video generation failed (1008): insufficient balance",
    },
    {
      body: task({ status: "failed", error: { code: "constructor", message: "future" } }),
      tag: "ProviderInternal",
      message: "MiniMax Video generation failed (constructor): future",
    },
    {
      body: task({ status: "cancelled" }),
      tag: "InvalidRequest",
      message: "MiniMax Video task task_1 was cancelled",
    },
    {
      body: task({ status: "succeeded" }),
      tag: "InvalidProviderOutput",
      message: "MiniMax Video completed without a video URL",
    },
  ]) {
    it.effect(`fails the result of ${terminal.message} with the provider body`, () =>
      Effect.gen(function* () {
        const error = yield* ai.video.result(h3, id).pipe(Effect.flip)
        expect(error.reason._tag).toBe(terminal.tag)
        expect(error.message).toBe(terminal.message)
        expect(error.reason.body).toBe(JSON.stringify(terminal.body))
      }).pipe(Effect.provide(layer((input) => Effect.succeed(json(input, terminal.body))))),
    )
  }

  it.effect("cancels with DELETE on the task", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      yield* ai.video
        .cancel(h3, id)
        .pipe(
          Effect.provide(
            layer((input) =>
              observe(calls, input).pipe(Effect.map(() => json(input, { task_id: "task_1", action: "cancelled" }))),
            ),
          ),
        )
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        "DELETE https://minimax.test/v2/video_generation/task_1",
      ])
    }),
  )
})

// ---------------------------------------------------------------------------
// Hailuo status, result, cancel
// ---------------------------------------------------------------------------

describe("MiniMax Video / Hailuo status, result and cancel", () => {
  it.effect("maps v1 statuses and keeps unknown ones running", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const statuses = yield* Effect.forEach(
        ["Preparing", "Queueing", "Processing", "Success", "Fail", "Warming"],
        (status) =>
          ai.video
            .status(hailuo, id)
            .pipe(
              Effect.provide(
                layer((input) => observe(calls, input).pipe(Effect.map(() => json(input, hailuoTask({ status }))))),
              ),
            ),
      )
      expect(statuses.map((value) => value.status)).toEqual([
        "queued",
        "queued",
        "running",
        "completed",
        "failed",
        "running",
      ])
      expect(calls[0].url).toBe("https://minimax.test/v1/query/video_generation?task_id=task_1")
    }),
  )

  it.effect("fails a status read that v1 answers with a non-zero base_resp", () =>
    Effect.gen(function* () {
      const error = yield* ai.video.status(hailuo, id).pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toContain("This task_id does not exist")
    }).pipe(
      Effect.provide(
        layer((input) =>
          Effect.succeed(
            json(
              input,
              hailuoTask({
                status: "",
                file_id: "",
                base_resp: { status_code: 2013, status_msg: "invalid params, This task_id does not exist" },
              }),
            ),
          ),
        ),
      ),
    ),
  )

  it.effect("looks up the file's download URL, which expires after one hour", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const response = yield* ai.video.result(hailuo, id).pipe(
        Effect.provide(
          layer((input) =>
            Effect.gen(function* () {
              const { call } = yield* observe(calls, input)
              if (call.url.includes("/query/"))
                return json(
                  input,
                  hailuoTask({ status: "Success", file_id: "file_9", video_width: 752, video_height: 1360 }),
                )
              return json(input, {
                file: { file_id: 9, bytes: 1024, download_url: "https://cdn.minimax.test/out.mp4?sig=1" },
                base_resp: { status_code: 0, status_msg: "success" },
              })
            }),
          ),
        ),
      )
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        "GET https://minimax.test/v1/query/video_generation?task_id=task_1",
        "GET https://minimax.test/v1/files/retrieve?file_id=file_9",
      ])
      expect(calls[1].headers.get("authorization")).toBe("Bearer test")
      expect(response.video.source).toEqual({
        type: "url",
        url: "https://cdn.minimax.test/out.mp4?sig=1",
        mediaType: "video/mp4",
        expiresAt: 60 * 60 * 1000,
      })
      expect(response.video.info).toEqual({ width: 752, height: 1360 })
      expect(response.providerMetadata).toEqual({ minimax: { taskId: "task_1", fileId: "file_9" } })
    }),
  )

  for (const terminal of [
    {
      body: hailuoTask({ status: "Fail", base_resp: { status_code: 1027, status_msg: "output sensitive" } }),
      tag: "ContentPolicy",
      message: "MiniMax Hailuo Video generation failed (1027): output sensitive",
    },
    {
      body: hailuoTask({ status: "Fail" }),
      tag: "ProviderInternal",
      message: "MiniMax Hailuo Video generation failed",
    },
    {
      body: hailuoTask({ status: "Processing" }),
      tag: "InvalidRequest",
      message: "MiniMax Hailuo Video generation task_1 has not finished; await it before reading the result",
    },
    {
      body: hailuoTask({ status: "Success", file_id: "" }),
      tag: "InvalidProviderOutput",
      message: "MiniMax Hailuo Video completed without a file_id",
    },
  ]) {
    it.effect(`fails the result with "${terminal.message}"`, () =>
      Effect.gen(function* () {
        const error = yield* ai.video.result(hailuo, id).pipe(Effect.flip)
        expect(error.reason._tag).toBe(terminal.tag)
        expect(error.message).toBe(terminal.message)
        expect(error.reason.body).toBe(JSON.stringify(terminal.body))
      }).pipe(Effect.provide(layer((input) => Effect.succeed(json(input, terminal.body))))),
    )
  }

  it.effect("fails cancel as unsupported without sending a request, since v1 has no cancel endpoint", () =>
    Effect.gen(function* () {
      const error = yield* ai.video.cancel(hailuo, id).pipe(Effect.flip)
      expect(error.reason._tag).toBe("UnsupportedOperation")
      expect(error.message).toContain("cancel")
    }).pipe(Effect.provide(layer(() => Effect.die("cancel reached the network")))),
  )
})
