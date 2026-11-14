import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import type { HttpClientResponse } from "effect/http"
import {
  ai,
  ImageClient,
  ImageModel,
  ImageResponse,
  Media,
  type GenerationStatus,
  type ImageRequest,
} from "../src/effect.js"
import { Google } from "../src/providers.js"
import { Auth, MediaProtocol } from "../src/route.js"
import { it } from "./lib/effect.js"
import { dynamicResponse, json, observe, settle, type Call } from "./lib/http.js"

const layer = (handler: Parameters<typeof dynamicResponse>[0]) =>
  ImageClient.layer.pipe(Layer.provideMerge(dynamicResponse(handler)))

// No shipped image protocol is queued, so this test-only one exercises the job calls over the real route machinery.
const route = MediaProtocol.identity({ id: "test-queued-image", name: "Queued Image", provider: "test" })

const STATUS = { pending: "running", done: "completed", failed: "failed" } as const satisfies Record<
  string,
  GenerationStatus
>

const decodeJob = route.decodeJson(
  Schema.Struct({
    status: Schema.String,
    progress: Schema.optional(Schema.Number),
    url: Schema.optional(Schema.String),
  }),
)

const decodeStatus = (response: HttpClientResponse.HttpClientResponse, context: MediaProtocol.PollContext<string>) =>
  decodeJob(response).pipe(
    Effect.map((output) => ({
      id: context.token,
      status: MediaProtocol.status(STATUS, output.value.status),
      progress: output.value.progress,
    })),
  )

const decodeResult = Effect.fn("QueuedImage.decodeResult")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<string>,
) {
  const output = yield* decodeJob(response)
  const status = MediaProtocol.status(STATUS, output.value.status)
  if (status === "running") return yield* output.pending(context.token)
  if (status === "failed") return yield* output.ended("failed", `${route.name} generation failed`)
  if (output.value.url === undefined) return yield* output.invalid(`${route.name} completed without an image URL`)
  return new ImageResponse({ images: [Media.url(output.value.url, { mediaType: "image/png" })] })
})

const jobPath = (id: string) => `/jobs/${encodeURIComponent(id)}`

const protocol = (cancel: boolean) =>
  MediaProtocol.queued<ImageRequest, ImageResponse, string>(route, {
    token: Schema.String,
    start: {
      body: { from: (request) => Effect.succeed(MediaProtocol.json({ prompt: request.prompt })) },
      decode: route.decodeStarted(Schema.Struct({ id: Schema.String }), (value) => ({
        token: value.id,
        snapshot: { id: value.id, status: "queued" },
      })),
    },
    status: { path: jobPath, decode: decodeStatus },
    result: { path: jobPath, decode: decodeResult },
    cancel: cancel ? { method: "DELETE", path: jobPath } : undefined,
  })

const queued = (cancel = true) =>
  ImageModel.fromRoute(
    { protocol: protocol(cancel), baseURL: "https://queued.test", path: "/jobs" },
    { id: "queued-image", auth: Auth.bearer("test") },
  )

const model = queued()

describe("ai.image.start / status / result / cancel", () => {
  it.effect("start submits and returns the job ID without polling", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const job = yield* ai.image
        .start({ model, prompt: "A lighthouse" })
        .pipe(
          Effect.provide(layer((input) => observe(calls, input).pipe(Effect.map(() => json(input, { id: "job_1" }))))),
        )
      expect(job).toEqual({ id: "job_1" })
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(["POST https://queued.test/jobs"])
      expect(JSON.parse(calls[0].body)).toEqual({ prompt: "A lighthouse" })
    }),
  )

  it.effect("status reads one status per call by job ID", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const statuses = yield* Effect.all([ai.image.status(model, "job/1"), ai.image.status(model, "job/1")]).pipe(
        Effect.provide(
          layer((input) =>
            observe(calls, input).pipe(
              Effect.map(({ nth }) =>
                json(input, nth === 1 ? { status: "pending", progress: 0.4 } : { status: "done", url: "x" }),
              ),
            ),
          ),
        ),
      )
      expect(statuses).toEqual([
        { status: "running", progress: 0.4 },
        { status: "completed", progress: undefined },
      ])
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        "GET https://queued.test/jobs/job%2F1",
        "GET https://queued.test/jobs/job%2F1",
      ])
    }),
  )

  it.effect("result fails while the job is running and returns the images once it completes", () =>
    Effect.gen(function* () {
      const pending = yield* ai.image
        .result(model, "job_1")
        .pipe(Effect.flip, Effect.provide(layer((input) => Effect.succeed(json(input, { status: "pending" })))))
      expect(pending.reason._tag).toBe("InvalidRequest")
      expect(pending.message).toContain("has not finished")

      const response = yield* ai.image
        .result(model, "job_1")
        .pipe(
          Effect.provide(
            layer((input) => Effect.succeed(json(input, { status: "done", url: "https://queued.test/out.png" }))),
          ),
        )
      expect(response.images.map((image) => image.source)).toEqual([
        { type: "url", url: "https://queued.test/out.png", mediaType: "image/png", expiresAt: undefined },
      ])
    }),
  )

  it.effect("cancel calls the provider when it has a cancel call and fails typed when it has none", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      yield* ai.image
        .cancel(model, "job_1")
        .pipe(Effect.provide(layer((input) => observe(calls, input).pipe(Effect.map(() => json(input, {}))))))
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(["DELETE https://queued.test/jobs/job_1"])

      const error = yield* ai.image
        .cancel(queued(false), "job_1")
        .pipe(Effect.flip, Effect.provide(layer(() => Effect.die("cancel reached the network"))))
      expect(error.reason._tag).toBe("UnsupportedOperation")
      expect("operation" in error.reason && error.reason.operation).toBe("image.cancel")
    }),
  )

  it.effect("generate still polls a queued route to the result", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const response = yield* settle(
        ai.image.generate({ model, prompt: "A lighthouse" }, { poll: { interval: "1 second" } }),
        5,
      ).pipe(
        Effect.provide(
          layer((input) =>
            observe(calls, input).pipe(
              Effect.map(({ call, nth }) => {
                if (call.method === "POST") return json(input, { id: "job_1" })
                return json(
                  input,
                  nth === 1 ? { status: "pending" } : { status: "done", url: "https://queued.test/a.png" },
                )
              }),
            ),
          ),
        ),
      )
      expect(response.images).toHaveLength(1)
      expect(calls[0].method).toBe("POST")
    }),
  )

  it.effect("every job call fails with UnsupportedOperation on an inline route before sending", () =>
    Effect.gen(function* () {
      const inline = Google.configure({ apiKey: "test" }).image("gemini-3.1-flash-image")
      const errors = yield* Effect.all(
        [
          ai.image.start({ model: inline, prompt: "A lighthouse" }),
          ai.image.status(inline, "job_1"),
          ai.image.result(inline, "job_1"),
          ai.image.cancel(inline, "job_1"),
        ].map((effect) => Effect.flip(effect)),
      )
      expect(errors.map((error) => [error.reason._tag, "operation" in error.reason && error.reason.operation])).toEqual(
        [
          ["UnsupportedOperation", "image.start"],
          ["UnsupportedOperation", "image.status"],
          ["UnsupportedOperation", "image.result"],
          ["UnsupportedOperation", "image.cancel"],
        ],
      )
    }).pipe(Effect.provide(layer(() => Effect.die("an unsupported job call reached the network")))),
  )
})
