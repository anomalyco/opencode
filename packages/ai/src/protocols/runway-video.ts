import { Duration, Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"
import type { Status } from "../generation.js"
import { Media } from "../media.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords, type OpenString } from "../schema/index.js"
import { VideoModel, VideoResponse, type VideoRequestFor } from "../video.js"
import { ProviderShared, optionalArray, optionalNull } from "./shared.js"

const route = MediaProtocol.identity({ id: "runway-video", name: "Runway", provider: "runway" })
export const DEFAULT_BASE_URL = "https://api.dev.runwayml.com/v1"
/** Every Runway request must pin the API version. */
export const API_VERSION = "2024-11-06"
export const TEXT_TO_VIDEO_PATH = "/text_to_video"
export const IMAGE_TO_VIDEO_PATH = "/image_to_video"
export const VIDEO_TO_VIDEO_PATH = "/video_to_video"
export const TASKS_PATH = "/tasks"
/** Output URLs are valid for 24–48 hours; the asset carries the conservative bound. */
const OUTPUT_RETENTION = Duration.hours(24)

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/**
 * Provider-native options. Common fields lower to Runway's names: `aspectRatio` → `ratio` (Runway expects pixel
 * ratios such as `1280:720` for most models), `durationSeconds` → `duration`, `audio`, `negativePrompt`,
 * `resolution`, `references`, and `frames` → `promptImage`.
 */
export type RunwayVideoOptions = {
  readonly contentModeration?: { readonly publicFigureThreshold?: OpenString<"auto" | "low"> }
  readonly outputFormat?: OpenString<"mp4" | "prores" | "png_sequence">
} & Record<string, unknown>

export type Request = VideoRequestFor<RunwayVideoOptions>

// ---------------------------------------------------------------------------
// 2. Token and response schemas
// ---------------------------------------------------------------------------

export const Token = Schema.Struct({ taskID: Schema.String })
export type Token = Schema.Schema.Type<typeof Token>

const Cost = Schema.Struct({ credits: Schema.Number })

const StartResponse = Schema.Struct({ id: Schema.String })

const Task = Schema.Struct({
  status: Schema.String,
  progress: optionalNull(Schema.Number),
  output: optionalArray(Schema.String),
  failure: optionalNull(Schema.String),
  failureCode: optionalNull(Schema.String),
  cost: Schema.optional(Cost),
  estimatedCost: Schema.optional(Cost),
})

const STATUS = {
  PENDING: "queued",
  THROTTLED: "queued",
  RUNNING: "running",
  SUCCEEDED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const satisfies Record<string, Status>

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

// Runway accepts HTTPS URLs, `runway://` upload URIs, and data URIs, all as one string.
const mediaUri = (asset: Media.Asset) =>
  ProviderShared.mediaReference(asset, route.provider, route.name).pipe(Effect.map((reference) => reference.value))

const fromRequest = Effect.fn("RunwayVideo.fromRequest")(function* (request: Request) {
  const first = request.frames?.first === undefined ? undefined : yield* mediaUri(request.frames.first)
  const last = request.frames?.last === undefined ? undefined : yield* mediaUri(request.frames.last)
  const promptImage = [
    ...(first === undefined ? [] : [{ uri: first, position: "first" }]),
    ...(last === undefined ? [] : [{ uri: last, position: "last" }]),
  ]
  const videoUri = request.video === undefined ? undefined : yield* mediaUri(request.video)
  const references = yield* Effect.forEach(request.references ?? [], (asset) =>
    mediaUri(asset).pipe(Effect.map((uri) => ({ uri }))),
  )
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        model: request.model.id,
        promptText: request.prompt,
        promptImage: promptImage.length === 0 ? undefined : promptImage,
        videoUri,
        references: references.length === 0 ? undefined : references,
        ratio: request.aspectRatio,
        duration: request.durationSeconds,
        resolution: request.resolution,
        audio: request.audio,
        negativePrompt: request.negativePrompt,
        seed: request.seed,
      },
      request.providerOptions,
      request.http?.body,
    ) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodeStart = route.decodeStarted(StartResponse, (value) => ({
  token: { taskID: value.id },
  snapshot: { id: value.id, status: "queued" },
}))

const decodeTask = route.decodeJson(Task)

const decodeStatus = Effect.fn("RunwayVideo.decodeStatus")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const output = yield* decodeTask(response)
  const status = yield* MediaProtocol.status(STATUS, output.value.status, output)
  return { id: context.token.taskID, status, progress: output.value.progress ?? undefined }
})

const decodeResult = Effect.fn("RunwayVideo.decodeResult")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const output = yield* decodeTask(response)
  const task = output.value
  const status = yield* MediaProtocol.status(STATUS, task.status, output)
  if (status === "failed") {
    const code = task.failureCode ?? undefined
    const message = `${route.name} task failed${code === undefined ? "" : ` (${code})`}${task.failure ? `: ${task.failure}` : ""}`
    // Runway failure codes are dotted paths; every moderation outcome carries a SAFETY segment.
    if (code !== undefined && /(^|\.)SAFETY(\.|$)/.test(code)) return yield* output.contentPolicy(message)
    return yield* output.ended("failed", message)
  }
  if (status === "cancelled")
    return yield* output.ended("cancelled", `${route.name} task ${context.token.taskID} was cancelled`)
  if (status !== "completed")
    return yield* output.invalid(`${route.name} task ${context.token.taskID} has not finished`)
  const urls = task.output ?? []
  if (urls.length === 0) return yield* output.invalid(`${route.name} task succeeded without any output`)
  return new VideoResponse({
    videos: yield* Effect.forEach(urls, (url) =>
      MediaProtocol.expiringUrl(url, OUTPUT_RETENTION, { mediaType: "video/mp4" }),
    ),
    usage: task.cost === undefined ? undefined : { type: "credits", credits: task.cost.credits },
    providerMetadata: {
      runway: {
        taskId: context.token.taskID,
        estimatedCredits: task.estimatedCost?.credits,
      },
    },
  })
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

const taskPath = (token: Token) => `${TASKS_PATH}/${token.taskID}`

export const protocol = MediaProtocol.queued<Request, VideoResponse, Token>(route, {
  token: Token,
  unsupported: ["n"],
  start: { body: { from: fromRequest }, decode: decodeStart },
  status: { path: taskPath, decode: decodeStatus },
  result: { path: taskPath, decode: decodeResult },
  cancel: { method: "DELETE", path: taskPath },
})

const startPath = (request: Request) => {
  if (request.video !== undefined) return VIDEO_TO_VIDEO_PATH
  if (request.frames?.first !== undefined || request.frames?.last !== undefined) return IMAGE_TO_VIDEO_PATH
  return TEXT_TO_VIDEO_PATH
}

export const model = (input: MediaRoute.ModelInput) =>
  VideoModel.fromRoute<RunwayVideoOptions, Token>(
    {
      protocol,
      baseURL: DEFAULT_BASE_URL,
      headers: { "X-Runway-Version": API_VERSION },
      path: ({ request }) => startPath(request),
    },
    input,
  )

export const RunwayVideo = {
  protocol,
  model,
} as const
