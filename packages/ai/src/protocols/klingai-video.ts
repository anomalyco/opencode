import { Clock, Duration, Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/http"
import type { Status } from "../generation.js"
import { Media } from "../media.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords, type OpenString } from "../schema/index.js"
import { VideoModel, VideoResponse, seconds, type VideoRequest } from "../video.js"
import { ProviderShared, optionalNull } from "./shared.js"

const route = MediaProtocol.identity({ id: "klingai-video", name: "Kling Video", provider: "klingai" })
export const DEFAULT_BASE_URL = "https://api-singapore.klingai.com"
export const STATUS_PATH = "/tasks"
/** Kling keeps generated results, and the task that points at them, for 30 days. */
export const RETENTION = Duration.days(30)

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

export type KlingEndpoint = "text-to-video" | "image-to-video" | "omni-video"

/** One native `contents` item, such as `{ type: "element", element_id, id }` or `{ type: "voice", voice_id }`. */
export type KlingContent = { readonly type: OpenString<"middle_frame" | "base_video" | "element" | "voice"> } & Record<
  string,
  unknown
>

/**
 * Provider-native options. Common fields (`start`, `end`, `references`, `duration`, `aspect`, `resolution`, `sound`)
 * live on the request. `endpoint` overrides the endpoint picked from the inputs, `contents` adds native items
 * (Elements, voices, a `base_video` to edit, middle frames) before the last frame, and `settings` / `options` merge
 * into the native objects, for example `settings.audio: "original"` to keep a reference video's sound.
 */
export type KlingVideoOptions = {
  readonly endpoint?: KlingEndpoint
  readonly contents?: ReadonlyArray<KlingContent>
  readonly settings?: {
    readonly audio?: OpenString<"native" | "original" | "off">
    readonly multi_shot?: boolean
  } & Record<string, unknown>
  readonly options?: {
    readonly callback_url?: string
    readonly external_task_id?: string
    readonly watermark_info?: { readonly enabled: boolean }
  } & Record<string, unknown>
} & Record<string, unknown>

export type Request = VideoRequest<VideoModel<KlingVideoOptions>>

// ---------------------------------------------------------------------------
// 2. Models and endpoints
// ---------------------------------------------------------------------------

/**
 * The path segment of each model and whether it has an Omni endpoint: `always` models only exist there, `references`
 * models use it for references, and `never` models have no reference input. models.dev lists some models under
 * Kling's older `model_name` values, which differ from the path segment. Unknown models use their ID as the segment.
 */
const MODELS: Record<string, { readonly segment: string; readonly omni: "always" | "references" | "never" }> = {
  "kling-4.0": { segment: "kling-4.0", omni: "references" },
  "kling-4.0-flash": { segment: "kling-4.0-flash", omni: "references" },
  "kling-3.0": { segment: "kling-3.0", omni: "never" },
  "kling-3.0-turbo": { segment: "kling-3.0-turbo", omni: "never" },
  "kling-3.0-omni": { segment: "kling-3.0-omni", omni: "always" },
  "kling-video-o1": { segment: "kling-o1", omni: "always" },
  "kling-o1": { segment: "kling-o1", omni: "always" },
  "kling-v2-6": { segment: "kling-2.6", omni: "never" },
  "kling-2.6": { segment: "kling-2.6", omni: "never" },
  "kling-v2-5-turbo": { segment: "kling-2.5-turbo", omni: "never" },
  "kling-2.5-turbo": { segment: "kling-2.5-turbo", omni: "never" },
}

const modelInfo = (id: string) => (Object.hasOwn(MODELS, id) ? MODELS[id] : { segment: id, omni: "references" })

const endpointFor = (request: Request): KlingEndpoint => {
  if (request.providerOptions?.endpoint !== undefined) return request.providerOptions.endpoint
  const omni = modelInfo(request.model.id).omni
  if (omni === "always" || (omni === "references" && (request.references ?? []).length > 0)) return "omni-video"
  if (request.start !== undefined || request.end !== undefined || request.providerOptions?.contents !== undefined)
    return "image-to-video"
  return "text-to-video"
}

// ---------------------------------------------------------------------------
// 3. Token and response schemas
// ---------------------------------------------------------------------------

export const Token = Schema.Struct({ taskID: Schema.String, createdAt: Schema.optional(Schema.Number) })
export type Token = Schema.Schema.Type<typeof Token>

const StartResponse = Schema.Struct({
  data: Schema.Struct({
    id: Schema.String,
    status: optionalNull(Schema.String),
    create_time: optionalNull(Schema.Number),
  }),
})

// Durations are documented as strings ("5.041"); numbers are accepted too.
const Seconds = Schema.Union([Schema.String, Schema.Number])

const Task = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  message: optionalNull(Schema.String),
  create_time: optionalNull(Schema.Number),
  external_id: optionalNull(Schema.String),
  outputs: optionalNull(
    Schema.Array(
      Schema.Struct({
        type: Schema.String,
        id: optionalNull(Schema.String),
        url: optionalNull(Schema.String),
        watermark_url: optionalNull(Schema.String),
        duration: optionalNull(Seconds),
      }),
    ),
  ),
  usage: optionalNull(Schema.Struct({ input_duration: optionalNull(Seconds), output_duration: optionalNull(Seconds) })),
  billing: optionalNull(Schema.Array(Schema.Unknown)),
})
type Task = Schema.Schema.Type<typeof Task>

const TaskResponse = Schema.Struct({ data: optionalNull(Schema.Array(Task)) })

// ---------------------------------------------------------------------------
// 4. Status table
// ---------------------------------------------------------------------------

// Legacy callbacks spell success `succeed`; both mean the same thing.
const STATUS = {
  submitted: "queued",
  processing: "running",
  succeeded: "completed",
  succeed: "completed",
  failed: "failed",
} as const satisfies Record<string, Status>

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

// Kling takes images as a URL or bare base64 (no `data:` prefix), and videos as URLs only.
const image = (asset: Media.Asset) => {
  const inline = asset.inline()
  if (inline) return Effect.succeed(inline.base64)
  return ProviderShared.mediaReference(asset, undefined, route.name).pipe(Effect.map((reference) => reference.value))
}

const video = Effect.fn("KlingVideo.video")(function* (asset: Media.Asset) {
  if (asset.source.type !== "url")
    return yield* route.unsupported("video.references", `${route.name} takes reference videos by URL only`)
  return asset.source.url
})

const fromRequest = Effect.fn("KlingVideo.fromRequest")(function* (request: Request) {
  const references = request.references ?? []
  if (references.some((asset) => asset.kind === "audio"))
    return yield* route.unsupported(
      "audio.references",
      `${route.name} has no reference audio input; pass a voice_id through providerOptions.contents`,
    )
  const endpoint = endpointFor(request)
  if (references.length > 0 && endpoint !== "omni-video")
    return yield* route.unsupported(
      "video.references",
      `${route.name} ${request.model.id} has no reference input; use a model with an Omni endpoint`,
    )
  if (endpoint === "text-to-video" && (request.start !== undefined || request.end !== undefined))
    return yield* route.unsupported("video.frames", `${route.name} text-to-video has no start or end frame input`)
  if (endpoint === "text-to-video" && request.providerOptions?.contents !== undefined)
    return yield* route.unsupported("video.contents", `${route.name} text-to-video has no contents input`)
  const { endpoint: _endpoint, contents: extra, ...native } = request.providerOptions ?? {}
  const first = request.start === undefined ? [] : [{ type: "first_frame", url: yield* image(request.start) }]
  const last = request.end === undefined ? [] : [{ type: "last_frame", url: yield* image(request.end) }]
  const images = references.filter((asset) => asset.kind !== "video")
  const videos = references.filter((asset) => asset.kind === "video")
  // Numbered ids let the prompt address each reference as `@image_1` or `@video_1`, as Kling's examples do.
  const referenceContents = [
    ...(yield* Effect.forEach(images, (asset, index) =>
      image(asset).pipe(Effect.map((url) => ({ type: "refer_image", url, id: `image_${index + 1}` }))),
    )),
    ...(yield* Effect.forEach(videos, (asset, index) =>
      video(asset).pipe(Effect.map((url) => ({ type: "feature_video", url, id: `video_${index + 1}` }))),
    )),
  ]
  const settings = {
    duration: request.duration === undefined ? undefined : seconds(request.duration),
    aspect_ratio: aspectRatio(request, endpoint),
    resolution: request.resolution,
    audio: request.sound === undefined ? undefined : request.sound ? "native" : "off",
  }
  const prompt =
    endpoint === "text-to-video"
      ? { prompt: request.prompt }
      : {
          // Kling wants the first frame first and the last frame last among the images.
          contents: [
            { type: "prompt", text: request.prompt },
            ...first,
            ...referenceContents,
            ...(extra ?? []),
            ...last,
          ],
        }
  return MediaProtocol.json(
    mergeJsonRecords({ ...prompt, settings: mergeJsonRecords(settings) }, native, request.http?.body) ?? {},
  )
})

// `auto` is Kling's `adaptive`. Image-to-video has no aspect field: the start frame sets the shape.
const aspectRatio = (request: Request, endpoint: KlingEndpoint) => {
  if (request.aspect !== "auto") return request.aspect
  return endpoint === "image-to-video" ? undefined : "adaptive"
}

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodeStart = route.decodeStarted(StartResponse, (value) => ({
  token: { taskID: value.data.id, createdAt: value.data.create_time ?? undefined },
  snapshot: { id: value.data.id, status: MediaProtocol.status(STATUS, value.data.status ?? "submitted") },
}))

const decodeTasks = route.decodeJson(TaskResponse)

const number = (value: string | number | null | undefined) => {
  if (value === undefined || value === null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

// A task only stays queryable for Kling's retention window, so a missing task past it has expired.
const pastRetention = (token: Token) =>
  Clock.currentTimeMillis.pipe(
    Effect.map((now) => token.createdAt !== undefined && now - token.createdAt >= Duration.toMillis(RETENTION)),
  )

const readTask = Effect.fn("KlingVideo.readTask")(function* (
  response: HttpClientResponse.HttpClientResponse,
  token: Token,
) {
  const output = yield* decodeTasks(response)
  const task = (output.value.data ?? []).find((item) => item.id === token.taskID)
  return { output, task }
})

const decodeStatus = Effect.fn("KlingVideo.decodeStatus")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const read = yield* readTask(response, context.token)
  if (read.task !== undefined)
    return { id: context.token.taskID, status: MediaProtocol.status(STATUS, read.task.status) }
  if (yield* pastRetention(context.token)) return { id: context.token.taskID, status: "expired" as const }
  return yield* read.output.invalid(`${route.name} returned no task ${context.token.taskID}`)
})

const decodeResult = Effect.fn("KlingVideo.decodeResult")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const read = yield* readTask(response, context.token)
  const output = read.output
  const task = read.task
  if (task === undefined) {
    if (yield* pastRetention(context.token))
      return yield* output.ended("expired", `${route.name} task ${context.token.taskID} expired`)
    return yield* output.invalid(`${route.name} returned no task ${context.token.taskID}`)
  }
  const status = MediaProtocol.status(STATUS, task.status)
  if (status === "queued" || status === "running") return yield* output.pending(context.token.taskID)
  if (status === "failed")
    return yield* output.ended("failed", `${route.name} generation failed${task.message ? `: ${task.message}` : ""}`)
  const videos = (task.outputs ?? []).filter((item) => item.type === "video")
  const urls = videos.flatMap((item) => (item.url ? [{ ...item, url: item.url }] : []))
  if (urls.length === 0) return yield* output.invalid(`${route.name} completed without a video URL`)
  const createdAt = task.create_time ?? context.token.createdAt
  const assets = yield* Effect.forEach(urls, (item) => {
    const duration = number(item.duration)
    const options = {
      mediaType: "video/mp4",
      info: duration === undefined ? undefined : { durationSeconds: duration },
      providerMetadata: {
        klingai: { id: item.id ?? undefined, watermarkUrl: item.watermark_url ?? undefined },
      },
    }
    if (createdAt === undefined) return MediaProtocol.expiringUrl(item.url, RETENTION, options)
    return Effect.succeed(Media.url(item.url, { ...options, expiresAt: createdAt + Duration.toMillis(RETENTION) }))
  })
  const billed = number(task.usage?.output_duration)
  return new VideoResponse({
    videos: assets,
    usage: billed === undefined ? undefined : { type: "seconds", seconds: billed },
    providerMetadata: {
      klingai: {
        taskId: task.id,
        externalTaskId: task.external_id ?? undefined,
        inputDuration: number(task.usage?.input_duration),
        billing: task.billing ?? undefined,
      },
    },
  })
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

const statusPath = (token: Token) => `${STATUS_PATH}?task_ids=${encodeURIComponent(token.taskID)}`

// Kling has no cancel endpoint, so `cancel` is left out and fails as unsupported.
export const protocol = MediaProtocol.queued<Request, VideoResponse, Token>(route, {
  token: Token,
  start: { body: { from: fromRequest }, decode: decodeStart },
  status: { path: statusPath, decode: decodeStatus },
  result: { path: statusPath, decode: decodeResult },
})

export const model = (input: MediaRoute.ModelInput) =>
  VideoModel.fromRoute<KlingVideoOptions, Token>(
    {
      protocol,
      baseURL: DEFAULT_BASE_URL,
      path: ({ request }) => `/${endpointFor(request)}/${modelInfo(request.model.id).segment}`,
    },
    input,
  )

export const KlingVideo = {
  protocol,
  model,
} as const
