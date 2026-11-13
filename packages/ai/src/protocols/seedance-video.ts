import { Duration, Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/http"
import type { Status } from "../generation.js"
import { Media } from "../media.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords } from "../schema/index.js"
import { VideoModel, VideoResponse, seconds, type VideoRequest } from "../video.js"
import { ProviderShared, optionalNull } from "./shared.js"

// One Ark API (`/contents/generations/tasks`) served by Volcengine Ark in China and BytePlus ModelArk elsewhere.
export const VOLCENGINE_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
export const BYTEPLUS_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3"
export const PATH = "/contents/generations/tasks"
// Video and last-frame URLs are documented as valid for 24 hours.
const OUTPUT_RETENTION = Duration.hours(24)

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/**
 * Provider-native options, merged into the task body. Common fields (`start`, `end`, `references`, `duration`,
 * `aspect`, `resolution`, `sound`) live on the request. `draft_task` adds a `draft_task` content item that turns a
 * Draft video into the final one.
 */
export type SeedanceVideoOptions = {
  readonly draft_task?: { readonly id: string }
  readonly draft?: boolean
  readonly frames?: number
  readonly seed?: number
  readonly camera_fixed?: boolean
  readonly watermark?: boolean
  readonly return_last_frame?: boolean
  readonly omni_reference_task_type?: "auto" | "reference" | "edit" | "extend" | (string & {})
  readonly output_format?: "mp4" | "mov" | (string & {})
  readonly service_tier?: "default" | "flex" | (string & {})
  readonly callback_url?: string
  readonly execution_expires_after?: number
  readonly priority?: number
  readonly safety_identifier?: string
} & Record<string, unknown>

export type Request = VideoRequest<VideoModel<SeedanceVideoOptions>>

// ---------------------------------------------------------------------------
// 2. Token and response schemas
// ---------------------------------------------------------------------------

export const Token = Schema.Struct({ taskID: Schema.String })
export type Token = Schema.Schema.Type<typeof Token>

const StartResponse = Schema.Struct({ id: Schema.String })

const Task = Schema.Struct({
  id: optionalNull(Schema.String),
  model: optionalNull(Schema.String),
  status: Schema.String,
  content: optionalNull(
    Schema.Struct({
      video_url: optionalNull(Schema.String),
      last_frame_url: optionalNull(Schema.String),
    }),
  ),
  error: optionalNull(
    Schema.Struct({
      code: optionalNull(Schema.String),
      message: optionalNull(Schema.String),
    }),
  ),
  usage: optionalNull(
    Schema.Struct({
      completion_tokens: optionalNull(Schema.Number),
      total_tokens: optionalNull(Schema.Number),
    }),
  ),
  updated_at: optionalNull(Schema.Number),
  seed: optionalNull(Schema.Number),
  resolution: optionalNull(Schema.String),
  ratio: optionalNull(Schema.String),
  duration: optionalNull(Schema.Number),
  frames: optionalNull(Schema.Number),
  framespersecond: optionalNull(Schema.Number),
  generate_audio: optionalNull(Schema.Boolean),
  output_format: optionalNull(Schema.String),
  draft: optionalNull(Schema.Boolean),
  service_tier: optionalNull(Schema.String),
})

const STATUS = {
  queued: "queued",
  running: "running",
  succeeded: "completed",
  failed: "failed",
  cancelled: "cancelled",
  expired: "expired",
} as const satisfies Record<string, Status>

// ---------------------------------------------------------------------------
// 3. Failures
// ---------------------------------------------------------------------------

// Ark error codes are dotted (`InvalidParameter.TaskTypeConstraint`); the leading segment is the category.
// `InternalServiceError`, `ServerOverloaded` and unknown codes are provider-side.
const FAILURE = {
  InvalidParameter: "InvalidRequest",
  MissingParameter: "InvalidRequest",
  InvalidArgumentError: "InvalidRequest",
  InvalidImageURL: "InvalidRequest",
  AuthenticationError: "Authentication",
  AccessDenied: "Authentication",
  QuotaExceeded: "RateLimit",
  RateLimitExceeded: "RateLimit",
} as const satisfies Record<string, MediaProtocol.Failure>

// Input and output moderation codes: `InputImageSensitiveContentDetected.PrivacyInformation`,
// `OutputVideoSensitiveContentDetected`, `SensitiveContentDetected`, ...
const moderated = (code: string | undefined) => code !== undefined && code.includes("SensitiveContentDetected")

// ---------------------------------------------------------------------------
// 4. Request body construction
// ---------------------------------------------------------------------------

const nativeOptions = (options: SeedanceVideoOptions | undefined) => {
  if (!options) return undefined
  const { draft_task: _draftTask, ...native } = options
  return native
}

// ---------------------------------------------------------------------------
// 5. Response decoding
// ---------------------------------------------------------------------------

// Ark returns `frames` when the request set it, otherwise `duration` rounded down to whole seconds.
const durationSeconds = (task: Schema.Schema.Type<typeof Task>) => {
  if (task.frames !== undefined && task.frames !== null && task.framespersecond)
    return task.frames / task.framespersecond
  return task.duration ?? undefined
}

// ---------------------------------------------------------------------------
// 6. Protocol and model, one per provider so assets and metadata carry the right provider ID
// ---------------------------------------------------------------------------

export type Provider = "volcengine" | "byteplus"

const make = (provider: Provider) => {
  const route = MediaProtocol.identity({ id: "seedance-video", name: "Seedance Video", provider })

  // `asset://<ID>` addresses a ModelArk digital character or authorized asset.
  const item = (asset: Media.Asset, type: "image_url" | "video_url" | "audio_url", role: string) =>
    ProviderShared.mediaReference(asset, route.provider, route.name).pipe(
      Effect.map(
        (reference): Record<string, unknown> => ({
          type,
          [type]: { url: reference.type === "ref" ? `asset://${reference.value}` : reference.value },
          role,
        }),
      ),
    )

  const reference = (asset: Media.Asset) => {
    if (asset.kind === "video") return item(asset, "video_url", "reference_video")
    if (asset.kind === "audio") return item(asset, "audio_url", "reference_audio")
    return item(asset, "image_url", "reference_image")
  }

  // Frames and references are separate Seedance modes; mixing them is sent as-is and rejected by the provider.
  const fromRequest = Effect.fn("SeedanceVideo.fromRequest")(function* (request: Request) {
    const content = [
      // Every media mode accepts an optional prompt, so an empty one adds no text item.
      ...(request.prompt === "" ? [] : [{ type: "text", text: request.prompt }]),
      ...(request.start === undefined ? [] : [yield* item(request.start, "image_url", "first_frame")]),
      ...(request.end === undefined ? [] : [yield* item(request.end, "image_url", "last_frame")]),
      ...(yield* Effect.forEach(request.references ?? [], reference)),
      ...(request.providerOptions?.draft_task === undefined
        ? []
        : [{ type: "draft_task", draft_task: request.providerOptions.draft_task }]),
    ]
    return MediaProtocol.json(
      mergeJsonRecords(
        {
          model: request.model.id,
          content,
          duration: request.duration === undefined ? undefined : seconds(request.duration),
          ratio: request.aspect === "auto" ? "adaptive" : request.aspect,
          resolution: request.resolution,
          generate_audio: request.sound,
        },
        nativeOptions(request.providerOptions),
        request.http?.body,
      ) ?? {},
    )
  })

  const decodeStart = route.decodeStarted(StartResponse, (value) => ({
    token: { taskID: value.id },
    snapshot: { id: value.id, status: "queued" },
  }))

  const decodeTask = route.decodeJson(Task)

  const decodeStatus = Effect.fn("SeedanceVideo.decodeStatus")(function* (
    response: HttpClientResponse.HttpClientResponse,
    context: MediaProtocol.PollContext<Token>,
  ) {
    const output = yield* decodeTask(response)
    return { id: context.token.taskID, status: MediaProtocol.status(STATUS, output.value.status) }
  })

  const decodeResult = Effect.fn("SeedanceVideo.decodeResult")(function* (
    response: HttpClientResponse.HttpClientResponse,
    context: MediaProtocol.PollContext<Token>,
  ) {
    const output = yield* decodeTask(response)
    const task = output.value
    const status = MediaProtocol.status(STATUS, task.status)
    if (status === "queued" || status === "running") return yield* output.pending(context.token.taskID)
    if (status === "failed") {
      const code = task.error?.code ?? undefined
      const detail = task.error?.message ?? undefined
      const message = `${route.name} generation failed${code === undefined ? "" : ` (${code})`}${detail === undefined ? "" : `: ${detail}`}`
      if (moderated(code)) return yield* output.contentPolicy(message)
      return yield* output.ended("failed", message, MediaProtocol.failure(FAILURE, code?.split(".")[0]))
    }
    if (status === "cancelled")
      return yield* output.ended("cancelled", `${route.name} task ${context.token.taskID} was cancelled`)
    if (status === "expired")
      return yield* output.ended("expired", `${route.name} task ${context.token.taskID} expired`)
    const videoURL = task.content?.video_url ?? undefined
    if (videoURL === undefined) return yield* output.invalid(`${route.name} completed without a video URL`)
    const duration = durationSeconds(task)
    const options = {
      mediaType: task.output_format === "mov" ? "video/quicktime" : "video/mp4",
      info: duration === undefined ? undefined : { durationSeconds: duration },
    }
    // `updated_at` is when the task reached `succeeded`, which starts the URL's retention window.
    const video =
      task.updated_at === undefined || task.updated_at === null
        ? yield* MediaProtocol.expiringUrl(videoURL, OUTPUT_RETENTION, options)
        : Media.url(videoURL, {
            ...options,
            expiresAt: task.updated_at * 1000 + Duration.toMillis(OUTPUT_RETENTION),
          })
    return new VideoResponse({
      videos: [video],
      usage:
        task.usage?.completion_tokens === undefined || task.usage.completion_tokens === null
          ? undefined
          : {
              type: "tokens",
              output: task.usage.completion_tokens,
              total: task.usage.total_tokens ?? undefined,
            },
      providerMetadata: {
        [provider]: {
          taskId: context.token.taskID,
          model: task.model ?? undefined,
          seed: task.seed ?? undefined,
          ratio: task.ratio ?? undefined,
          resolution: task.resolution ?? undefined,
          duration: task.duration ?? undefined,
          frames: task.frames ?? undefined,
          framesPerSecond: task.framespersecond ?? undefined,
          generateAudio: task.generate_audio ?? undefined,
          outputFormat: task.output_format ?? undefined,
          draft: task.draft ?? undefined,
          serviceTier: task.service_tier ?? undefined,
          lastFrameUrl: task.content?.last_frame_url ?? undefined,
        },
      },
    })
  })

  const taskPath = (token: Token) => `${PATH}/${token.taskID}`

  // DELETE cancels a queued task. Ark refuses it for a running task, and deletes the record of a finished one.
  const protocol = MediaProtocol.queued<Request, VideoResponse, Token>(route, {
    token: Token,
    start: { body: { from: fromRequest }, decode: decodeStart },
    status: { path: taskPath, decode: decodeStatus },
    result: { path: taskPath, decode: decodeResult },
    cancel: { method: "DELETE", path: taskPath },
  })

  const model = (input: MediaRoute.ModelInput) =>
    VideoModel.fromRoute<SeedanceVideoOptions, Token>(
      {
        protocol,
        baseURL: provider === "volcengine" ? VOLCENGINE_BASE_URL : BYTEPLUS_BASE_URL,
        path: PATH,
      },
      input,
    )

  return { protocol, model }
}

export const SeedanceVideo = {
  volcengine: make("volcengine"),
  byteplus: make("byteplus"),
} as const
