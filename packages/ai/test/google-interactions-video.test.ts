import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Media, VideoClient, ai } from "../src/effect.js"
import { Google } from "../src/providers.js"
import { it } from "./lib/effect.js"
import { dynamicResponse, json, observe, type Call } from "./lib/http.js"

const layer = (handler: Parameters<typeof dynamicResponse>[0]) =>
  VideoClient.layer.pipe(Layer.provideMerge(dynamicResponse(handler)))

const model = Google.configure({ apiKey: "test", baseURL: "https://google.test/v1beta" }).video("gemini-omni-1.2-flash")
const id = "v1_abc"
const started = { id: "v1_abc", status: "in_progress", object: "interaction", model: "gemini-omni-1.2-flash" }
// "AAAAIGZ0eXBpc29t" is the base64 of an MP4 `ftyp` box header.
const completed = {
  id: "v1_abc",
  status: "completed",
  model: "gemini-omni-1.2-flash",
  usage: { total_input_tokens: 17, total_output_tokens: 5793, total_thought_tokens: 361, total_tokens: 6171 },
  steps: [
    { type: "user_input", content: [{ type: "text", text: "x" }] },
    { type: "thought", signature: "sig" },
    { type: "model_output", content: [{ type: "video", mime_type: "video/mp4", data: "AAAAIGZ0eXBpc29t" }] },
  ],
}

const sent = (input: Parameters<typeof ai.video.start>[0]) =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    const job = yield* ai.video
      .start(input)
      .pipe(Effect.provide(layer((request) => observe(calls, request).pipe(Effect.map(() => json(request, started))))))
    return { job, calls, body: JSON.parse(calls[0].body) }
  })

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

describe("ai.video.start / Google Interactions", () => {
  it.effect("maps the request onto a background interaction and returns the job without polling", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const job = yield* ai.video
        .start({
          model,
          prompt: "A balloon drifts upward",
          duration: "3 seconds",
          aspect: "9:16",
          resolution: "4K",
          sound: true,
          providerOptions: { service_tier: "flex", response_format: { delivery: "uri" } },
          headers: { "x-request": "yes" },
          http: { query: { trace: "1" } },
        })
        .pipe(
          Effect.provide(
            layer((input) =>
              Effect.gen(function* () {
                const { call } = yield* observe(calls, input)
                expect(call.headers.get("x-goog-api-key")).toBe("test")
                expect(call.headers.get("x-request")).toBe("yes")
                return json(input, started)
              }),
            ),
          ),
        )
      expect(job).toEqual({ id: "v1_abc" })
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        "POST https://google.test/v1beta/interactions?trace=1",
      ])
      expect(JSON.parse(calls[0].body)).toEqual({
        model: "gemini-omni-1.2-flash",
        input: [{ type: "text", text: "A balloon drifts upward" }],
        background: true,
        response_format: { type: "video", aspect_ratio: "9:16", resolution: "4k", duration: "3s", delivery: "uri" },
        service_tier: "flex",
      })
    }),
  )

  it.effect("leaves unset fields out instead of filling defaults", () =>
    Effect.gen(function* () {
      const { body } = yield* sent({ model, prompt: "x" })
      expect(body).toEqual({ model: "gemini-omni-1.2-flash", input: [{ type: "text", text: "x" }], background: true })
    }),
  )

  it.effect("leaves the aspect ratio out for auto so the model follows the input", () =>
    Effect.gen(function* () {
      const { body } = yield* sent({ model, prompt: "x", start: "data:image/png;base64,AQID", aspect: "auto" })
      expect(body.response_format).toBeUndefined()
      const sized = yield* sent({ model, prompt: "x", aspect: "auto", resolution: "720p" })
      expect(sized.body.response_format).toEqual({ type: "video", resolution: "720p" })
    }),
  )

  it.effect("sends start and end as the first two images and pins the frame task", () =>
    Effect.gen(function* () {
      const { body } = yield* sent({
        model,
        prompt: "Morph",
        start: Media.image(Media.fromDataUrl("data:image/png;base64,AQID")),
        end: Media.image(
          Media.ref("google", "https://generativelanguage.googleapis.com/v1beta/files/last", "image/jpeg"),
        ),
      })
      expect(body.input).toEqual([
        { type: "image", data: "AQID", mime_type: "image/png" },
        { type: "image", uri: "https://generativelanguage.googleapis.com/v1beta/files/last", mime_type: "image/jpeg" },
        { type: "text", text: "Morph" },
      ])
      expect(body.generation_config).toEqual({ video_config: { task: "image_to_video" } })
    }),
  )

  it.effect("sends references as image and video parts and pins the reference task", () =>
    Effect.gen(function* () {
      const { body } = yield* sent({
        model,
        prompt: "The cat plays",
        references: [
          Media.fromDataUrl("data:image/png;base64,AQID"),
          Media.url("https://example.test/motion.mp4", { mediaType: "video/mp4" }),
        ],
      })
      expect(body.input).toEqual([
        { type: "image", data: "AQID", mime_type: "image/png" },
        { type: "video", uri: "https://example.test/motion.mp4", mime_type: "video/mp4" },
        { type: "text", text: "The cat plays" },
      ])
      expect(body.generation_config).toEqual({ video_config: { task: "reference_to_video" } })
    }),
  )

  it.effect("sends frames with references without a task, and lets providerOptions set one", () =>
    Effect.gen(function* () {
      const image = Media.fromDataUrl("data:image/png;base64,AQID")
      const mixed = yield* sent({ model, prompt: "x", start: image, references: [image] })
      expect(mixed.body.input).toHaveLength(3)
      expect(mixed.body.generation_config).toBeUndefined()
      const edit = yield* sent({
        model,
        prompt: "Make it anime",
        references: [Media.url("https://example.test/in.mp4", { mediaType: "video/mp4" })],
        providerOptions: { generation_config: { video_config: { task: "edit" } } },
      })
      expect(edit.body.generation_config).toEqual({ video_config: { task: "edit" } })
    }),
  )

  it.effect("sends nothing for sound, since Omni always generates audio and has no field for it", () =>
    Effect.gen(function* () {
      const silent = yield* sent({ model, prompt: "x", sound: false })
      expect(JSON.stringify(silent.body)).not.toContain("audio")
    }),
  )

  for (const rejected of [
    { name: "an end frame without a start frame", input: { end: "data:image/png;base64,AQID" }, operation: "end" },
  ])
    it.effect(`rejects ${rejected.name}, which Omni has no way to send, before sending`, () =>
      Effect.gen(function* () {
        const error = yield* ai.video.start({ model, prompt: "x", ...rejected.input }).pipe(Effect.flip)
        expect(error.reason._tag).toBe("UnsupportedOperation")
        expect(error.reason).toMatchObject({ operation: `video.${rejected.operation}` })
      }).pipe(Effect.provide(layer(() => Effect.die("an unsupported request reached the network")))),
    )
})

// ---------------------------------------------------------------------------
// status, result, cancel
// ---------------------------------------------------------------------------

describe("ai.video.status / result / cancel / Google Interactions", () => {
  it.effect("reads statuses from a JSON round-tripped token", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const statuses = yield* Effect.gen(function* () {
        const job = yield* ai.video.start({ model, prompt: "x" })
        const decoded: unknown = job.id
        return [yield* ai.video.status(model, decoded), yield* ai.video.status(model, decoded)]
      }).pipe(
        Effect.provide(
          layer((input) =>
            Effect.gen(function* () {
              const { call, nth } = yield* observe(calls, input)
              if (call.method === "POST") return json(input, started)
              return json(input, nth === 1 ? started : completed)
            }),
          ),
        ),
      )
      expect(statuses).toEqual([{ status: "running" }, { status: "completed" }])
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        "POST https://google.test/v1beta/interactions",
        "GET https://google.test/v1beta/interactions/v1_abc",
        "GET https://google.test/v1beta/interactions/v1_abc",
      ])
    }),
  )

  it.effect("maps documented statuses and keeps unknown ones running", () =>
    Effect.gen(function* () {
      const statuses = yield* Effect.forEach(
        ["in_progress", "completed", "incomplete", "failed", "cancelled", "requires_action", "constructor"],
        (status) =>
          ai.video
            .status(model, id)
            .pipe(Effect.provide(layer((input) => Effect.succeed(json(input, { id: "v1_abc", status }))))),
      )
      expect(statuses.map((value) => value.status)).toEqual([
        "running",
        "completed",
        "completed",
        "failed",
        "cancelled",
        "running",
        "running",
      ])
    }),
  )

  it.effect("decodes the inline video with token usage and interaction metadata", () =>
    Effect.gen(function* () {
      const response = yield* ai.video.result(model, id)
      expect(response.videos).toHaveLength(1)
      expect(response.video.source.type).toBe("bytes")
      expect(response.video.mediaType).toBe("video/mp4")
      expect(response.video.inline()?.base64).toBe("AAAAIGZ0eXBpc29t")
      expect(response.usage).toMatchObject({ type: "tokens", input: 17, output: 5793, total: 6171 })
      expect(response.providerMetadata).toEqual({
        google: { interactionId: "v1_abc", model: "gemini-omni-1.2-flash", status: "completed" },
      })
    }).pipe(Effect.provide(layer((input) => Effect.succeed(json(input, completed))))),
  )

  it.effect("keeps a Files API video URI as a Google reference", () =>
    Effect.gen(function* () {
      const response = yield* ai.video.result(model, id)
      expect(response.video.source).toEqual({
        type: "ref",
        provider: "google",
        id: "https://generativelanguage.googleapis.com/v1beta/files/out:download?alt=media",
        mediaType: "video/mp4",
      })
    }).pipe(
      Effect.provide(
        layer((input) =>
          Effect.succeed(
            json(input, {
              id: "v1_abc",
              status: "completed",
              steps: [
                {
                  type: "model_output",
                  content: [
                    {
                      type: "video",
                      mime_type: "video/mp4",
                      uri: "https://generativelanguage.googleapis.com/v1beta/files/out:download?alt=media",
                    },
                  ],
                },
              ],
            }),
          ),
        ),
      ),
    ),
  )

  it.effect("fails a result read before the interaction finishes", () =>
    Effect.gen(function* () {
      const error = yield* ai.video.result(model, id).pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toBe(
        "Google Interactions Video generation v1_abc has not finished; await it before reading the result",
      )
    }).pipe(Effect.provide(layer((input) => Effect.succeed(json(input, started))))),
  )

  for (const terminal of [
    {
      body: {
        id: "v1_abc",
        status: "failed",
        errors: [{ code: "type.googleapis.com/INVALID_ARGUMENT", message: "Bad duration." }],
      },
      tag: "InvalidRequest",
      message: "Google Interactions Video generation failed (INVALID_ARGUMENT): Bad duration.",
    },
    {
      body: { id: "v1_abc", status: "failed", errors: [{ code: "resource-exhausted", message: "Slow down." }] },
      tag: "RateLimit",
      message: "Google Interactions Video generation failed (RESOURCE_EXHAUSTED): Slow down.",
    },
    {
      body: { id: "v1_abc", status: "failed", errors: [{ code: "SAFETY", message: "Blocked." }] },
      tag: "ContentPolicy",
      message: "Google Interactions Video generation failed (SAFETY): Blocked.",
    },
    {
      body: { id: "v1_abc", status: "failed" },
      tag: "ProviderInternal",
      message: "Google Interactions Video generation failed",
    },
    {
      body: { id: "v1_abc", status: "cancelled" },
      tag: "InvalidRequest",
      message: "Google Interactions Video interaction v1_abc was cancelled",
    },
    {
      body: { id: "v1_abc", status: "completed", steps: [], errors: [{ code: "PROHIBITED_CONTENT", message: "No." }] },
      tag: "ContentPolicy",
      message: "Google Interactions Video withheld the video: No.",
    },
    {
      body: { id: "v1_abc", status: "incomplete", steps: [] },
      tag: "InvalidProviderOutput",
      message: "Google Interactions Video incomplete without a video",
    },
  ])
    it.effect(`fails the result of a ${terminal.body.status} interaction as ${terminal.tag}`, () =>
      Effect.gen(function* () {
        const error = yield* ai.video.result(model, id).pipe(Effect.flip)
        expect(error.reason._tag).toBe(terminal.tag)
        expect(error.message).toBe(terminal.message)
        expect(error.reason.body).toBe(JSON.stringify(terminal.body))
      }).pipe(Effect.provide(layer((input) => Effect.succeed(json(input, terminal.body))))),
    )

  it.effect("cancels through the interaction cancel endpoint", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      yield* ai.video
        .cancel(model, id)
        .pipe(
          Effect.provide(
            layer((input) =>
              observe(calls, input).pipe(Effect.map(() => json(input, { id: "v1_abc", status: "cancelled" }))),
            ),
          ),
        )
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        "POST https://google.test/v1beta/interactions/v1_abc/cancel",
      ])
      expect(calls[0].headers.get("x-goog-api-key")).toBe("test")
    }),
  )
})
