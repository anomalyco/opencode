import { Duration, Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/http"
import type { Status } from "../generation.js"
import { Media } from "../media.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { AIError, QuotaExceededError, mergeJsonRecords, type OpenString } from "../schema/index.js"
import { VideoModel, VideoResponse, seconds, type VideoRequest } from "../video.js"
import { ProviderShared, optionalNull } from "./shared.js"

// MiniMax runs two video APIs with different bodies, statuses and results: H3 on v2 and Hailuo on v1.
const route = MediaProtocol.identity({ id: "minimax-video", name: "MiniMax Video", provider: "minimax" })
const hailuoRoute = MediaProtocol.identity({
  id: "minimax-hailuo-video",
  name: "MiniMax Hailuo Video",
  provider: "minimax",
})
/** The API host without a version: H3 is served under `/v2` and Hailuo under `/v1`. */
export const DEFAULT_BASE_URL = "https://api.minimax.io"
export const PATH = "/v2/video_generation"
export const STATUS_PATH = "/v2/query/video_generation"
export const HAILUO_PATH = "/v1/video_generation"
export const HAILUO_STATUS_PATH = "/v1/query/video_generation"
export const FILE_PATH = "/v1/files/retrieve"
const DOWNLOAD_RETENTION = Duration.hours(1)

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/**
 * Provider-native options, merged into the body. Common fields (`start`, `end`, `references`, `duration`, `aspect`,
 * `resolution`, `sound`) live on the request. `extra` and `response_format` are H3 (v2) fields; `prompt_optimizer`
 * and `fast_pretreatment` are Hailuo (v1) fields; both APIs take `callback_url`.
 */
export type MiniMaxVideoOptions = {
  readonly extra?: { readonly prompt_expansion_mode?: OpenString<"disabled" | "balanced" | "quality"> }
  readonly response_format?: OpenString<"task" | "flat">
  readonly prompt_optimizer?: boolean
  readonly fast_pretreatment?: boolean
  readonly callback_url?: string
} & Record<string, unknown>

export type Request = VideoRequest<VideoModel<MiniMaxVideoOptions>>

// ---------------------------------------------------------------------------
// 2. Token and response schemas
// ---------------------------------------------------------------------------

/** The provider's job ID; it is all a later status, result or cancel call needs. */
export const Token = Schema.String
export type Token = Schema.Schema.Type<typeof Token>

const BaseResp = optionalNull(
  Schema.Struct({
    status_code: Schema.Number,
    status_msg: optionalNull(Schema.String),
  }),
)

const StartResponse = Schema.Struct({ task_id: Schema.String })

const Task = Schema.Struct({
  id: optionalNull(Schema.String),
  model: optionalNull(Schema.String),
  status: optionalNull(Schema.String),
  error: optionalNull(
    Schema.Struct({
      code: optionalNull(Schema.Union([Schema.String, Schema.Number])),
      message: optionalNull(Schema.String),
    }),
  ),
  content: optionalNull(Schema.Struct({ url: optionalNull(Schema.String) })),
  resolution: optionalNull(Schema.String),
  duration: optionalNull(Schema.Number),
  ratio: optionalNull(Schema.String),
  usage: optionalNull(Schema.Record(Schema.String, Schema.Unknown)),
})

// `response_format: "flat"` moves the task fields from `task` to the top level.
const TaskResponse = Schema.Struct({ ...Task.fields, task: optionalNull(Task) })

const HailuoStartResponse = Schema.Struct({ task_id: optionalNull(Schema.String), base_resp: BaseResp })

const HailuoTask = Schema.Struct({
  status: optionalNull(Schema.String),
  file_id: optionalNull(Schema.String),
  video_width: optionalNull(Schema.Number),
  video_height: optionalNull(Schema.Number),
  base_resp: BaseResp,
})

const HailuoFile = Schema.Struct({
  file: optionalNull(
    Schema.Struct({
      download_url: optionalNull(Schema.String),
    }),
  ),
  base_resp: BaseResp,
})

const STATUS = {
  queued: "queued",
  running: "running",
  succeeded: "completed",
  failed: "failed",
  cancelled: "cancelled",
} as const satisfies Record<string, Status>

const HAILUO_STATUS = {
  Preparing: "queued",
  Queueing: "queued",
  Processing: "running",
  Success: "completed",
  Fail: "failed",
} as const satisfies Record<string, Status>

// ---------------------------------------------------------------------------
// 3. Failures
// ---------------------------------------------------------------------------

// Error codes from https://platform.minimax.io/docs/api-reference/errorcode; unknown codes are provider-side.
const FAILURE: Readonly<Record<string, MediaProtocol.Failure>> = {
  1002: "RateLimit",
  1004: "Authentication",
  1039: "RateLimit",
  2013: "InvalidRequest",
  2049: "Authentication",
}
const INSUFFICIENT_BALANCE = 1008
// 1026 flags the input and 1027 the generated video.
const CONTENT_POLICY = new Set(["1026", "1027"])

type Output = Effect.Success<ReturnType<typeof route.text>>

const failed = (output: Output, name: string, code: string | number | undefined, detail: string | undefined) => {
  const message = `${name} generation failed${code === undefined ? "" : ` (${code})`}${detail === undefined ? "" : `: ${detail}`}`
  if (code !== undefined && CONTENT_POLICY.has(String(code))) return output.contentPolicy(message)
  if (code !== undefined && Number(code) === INSUFFICIENT_BALANCE)
    return new AIError({ reason: new QuotaExceededError({ message, body: output.body, http: output.http }) })
  return output.ended("failed", message, MediaProtocol.failure(FAILURE, code))
}

// v1 answers errors with HTTP 200 and a non-zero `base_resp.status_code`.
const baseError = (
  output: Output,
  base: { readonly status_code: number; readonly status_msg?: string | null } | null | undefined,
) =>
  base === undefined || base === null || base.status_code === 0
    ? undefined
    : failed(output, hailuoRoute.name, base.status_code, base.status_msg ?? undefined)

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

/** H3 takes URLs, data URIs and `mm_file://{file_id}` references to MiniMax files. */
const mediaUrl = (asset: Media.Asset) =>
  ProviderShared.mediaReference(asset, route.provider, route.name).pipe(
    Effect.map((reference) => (reference.type === "ref" ? `mm_file://${reference.value}` : reference.value)),
  )

const ROLES = { image: "reference_image", video: "reference_video", audio: "reference_audio" } as const

const item = (asset: Media.Asset, role: string) =>
  mediaUrl(asset).pipe(
    Effect.map((url) => {
      const type = asset.kind === "video" ? "video_url" : asset.kind === "audio" ? "audio_url" : "image_url"
      return { type, [type]: { url }, role }
    }),
  )

const reference = (asset: Media.Asset) =>
  item(asset, asset.kind === "video" || asset.kind === "audio" ? ROLES[asset.kind] : ROLES.image)

/** MiniMax spells resolutions in uppercase (`480P`, `768P`, `2K`). */
const resolution = (request: Request) => request.resolution?.toUpperCase()

const fromRequest = Effect.fn("MiniMaxVideo.fromRequest")(function* (request: Request) {
  // H3 always generates a soundtrack and has no field for `sound`, so it isn't sent.
  const content = [
    { type: "text", text: request.prompt },
    ...(request.start === undefined ? [] : [yield* item(request.start, "first_frame")]),
    ...(request.end === undefined ? [] : [yield* item(request.end, "last_frame")]),
    ...(yield* Effect.forEach(request.references ?? [], reference)),
  ]
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        model: request.model.id,
        content,
        resolution: resolution(request),
        duration: request.duration === undefined ? undefined : seconds(request.duration),
        ratio: request.aspect === "auto" ? "adaptive" : request.aspect,
      },
      request.providerOptions,
      request.http?.body,
    ) ?? {},
  )
})

/** v1 documents URLs and data URLs only, so MiniMax file references aren't sent. */
const hailuoUrl = (asset: Media.Asset) =>
  ProviderShared.mediaReference(asset, undefined, hailuoRoute.name).pipe(Effect.map((reference) => reference.value))

const hailuoFromRequest = Effect.fn("MiniMaxHailuoVideo.fromRequest")(function* (request: Request) {
  const references = request.references ?? []
  if (references.some((asset) => asset.kind === "video" || asset.kind === "audio"))
    return yield* hailuoRoute.unsupported(
      "video.references",
      `${hailuoRoute.name} takes only image (subject) references`,
    )
  // Hailuo output is always silent and its shape follows the model or the first frame, with no field for either.
  // `sound` has nothing to send, so it isn't; an aspect ratio would change the shape the caller asked for.
  if (request.aspect !== undefined && request.aspect !== "auto")
    return yield* hailuoRoute.unsupported("video.aspect", `${hailuoRoute.name} has no aspect ratio input`)
  const subjects = yield* Effect.forEach(references, (asset) =>
    hailuoUrl(asset).pipe(Effect.map((url) => ({ type: "character", image: [url] }))),
  )
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        model: request.model.id,
        prompt: request.prompt,
        first_frame_image: request.start === undefined ? undefined : yield* hailuoUrl(request.start),
        last_frame_image: request.end === undefined ? undefined : yield* hailuoUrl(request.end),
        subject_reference: subjects.length === 0 ? undefined : subjects,
        duration: request.duration === undefined ? undefined : seconds(request.duration),
        resolution: resolution(request),
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
  token: value.task_id,
  snapshot: { id: value.task_id, status: "queued" },
}))

const decodeTask = route.decodeJson(TaskResponse)

const decodeStatus = Effect.fn("MiniMaxVideo.decodeStatus")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const output = yield* decodeTask(response)
  const task = output.value.task ?? output.value
  return { id: context.token, status: MediaProtocol.status(STATUS, task.status ?? "") }
})

const decodeResult = Effect.fn("MiniMaxVideo.decodeResult")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const output = yield* decodeTask(response)
  const task = output.value.task ?? output.value
  const status = MediaProtocol.status(STATUS, task.status ?? "")
  if (status === "queued" || status === "running") return yield* output.pending(context.token)
  if (status === "failed")
    return yield* failed(output, route.name, task.error?.code ?? undefined, task.error?.message ?? undefined)
  if (status !== "completed")
    return yield* output.ended("cancelled", `${route.name} task ${context.token} was cancelled`)
  const url = task.content?.url ?? undefined
  if (url === undefined) return yield* output.invalid(`${route.name} completed without a video URL`)
  const duration = task.duration ?? undefined
  const total = task.usage?.total_seconds
  return new VideoResponse({
    // The URL is time-limited without a documented window; reading the result again returns a fresh one.
    videos: [
      Media.url(url, {
        mediaType: "video/mp4",
        info: duration === undefined ? undefined : { durationSeconds: duration },
      }),
    ],
    usage: typeof total === "number" ? { type: "seconds", seconds: total } : undefined,
    providerMetadata: {
      minimax: {
        taskId: context.token,
        model: task.model ?? undefined,
        resolution: task.resolution ?? undefined,
        ratio: task.ratio ?? undefined,
        usage: task.usage ?? undefined,
      },
    },
  })
})

const decodeHailuoStart = Effect.fn("MiniMaxHailuoVideo.decodeStart")(function* (
  response: HttpClientResponse.HttpClientResponse,
) {
  const output = yield* hailuoRoute.decodeJson(HailuoStartResponse)(response)
  const error = baseError(output, output.value.base_resp)
  if (error) return yield* error
  const taskID = output.value.task_id ?? ""
  if (taskID === "") return yield* output.invalid(`${hailuoRoute.name} returned no task_id`)
  return { token: taskID, snapshot: { id: taskID, status: "queued" as const } }
})

const decodeHailuoTask = hailuoRoute.decodeJson(HailuoTask)

const decodeHailuoStatus = Effect.fn("MiniMaxHailuoVideo.decodeStatus")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const output = yield* decodeHailuoTask(response)
  const status = MediaProtocol.status(HAILUO_STATUS, output.value.status ?? "")
  // A failed task also carries its reason in `base_resp`; any other non-zero code is a failed read.
  const error = status === "failed" ? undefined : baseError(output, output.value.base_resp)
  if (error) return yield* error
  return { id: context.token, status }
})

const decodeHailuoFile = hailuoRoute.decodeJson(HailuoFile)

const decodeHailuoResult = Effect.fn("MiniMaxHailuoVideo.decodeResult")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const output = yield* decodeHailuoTask(response)
  const task = output.value
  const status = MediaProtocol.status(HAILUO_STATUS, task.status ?? "")
  const error = baseError(output, task.base_resp)
  if (status === "failed") return yield* error ?? failed(output, hailuoRoute.name, undefined, undefined)
  if (error) return yield* error
  if (status !== "completed") return yield* output.pending(context.token)
  const fileID = task.file_id ?? ""
  if (fileID === "") return yield* output.invalid(`${hailuoRoute.name} completed without a file_id`)
  // The task names a file; its download URL takes a second lookup and is valid for one hour.
  const file = yield* decodeHailuoFile(yield* context.get(`${FILE_PATH}?file_id=${encodeURIComponent(fileID)}`))
  const fileError = baseError(file, file.value.base_resp)
  if (fileError) return yield* fileError
  const url = file.value.file?.download_url ?? undefined
  if (url === undefined) return yield* file.invalid(`${hailuoRoute.name} returned no download_url for ${fileID}`)
  const width = task.video_width ?? undefined
  const height = task.video_height ?? undefined
  return new VideoResponse({
    videos: [
      yield* MediaProtocol.expiringUrl(url, DOWNLOAD_RETENTION, {
        mediaType: "video/mp4",
        info: width === undefined && height === undefined ? undefined : { width, height },
      }),
    ],
    providerMetadata: {
      minimax: { taskId: context.token, fileId: fileID },
    },
  })
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.queued<Request, VideoResponse, Token>(route, {
  token: Token,
  start: { body: { from: fromRequest }, decode: decodeStart },
  status: { path: (token) => `${STATUS_PATH}/${encodeURIComponent(token)}`, decode: decodeStatus },
  result: { path: (token) => `${STATUS_PATH}/${encodeURIComponent(token)}`, decode: decodeResult },
  // Cancels a queued task; MiniMax rejects it once the task is running.
  cancel: { method: "DELETE", path: (token) => `${PATH}/${encodeURIComponent(token)}` },
})

const hailuoStatusPath = (token: Token) => `${HAILUO_STATUS_PATH}?task_id=${encodeURIComponent(token)}`

export const hailuoProtocol = MediaProtocol.queued<Request, VideoResponse, Token>(hailuoRoute, {
  token: Token,
  start: { body: { from: hailuoFromRequest }, decode: decodeHailuoStart },
  status: { path: hailuoStatusPath, decode: decodeHailuoStatus },
  result: { path: hailuoStatusPath, decode: decodeHailuoResult },
})

/** H3 and later models on the v2 API. */
export const h3Model = (input: MediaRoute.ModelInput) =>
  VideoModel.fromRoute<MiniMaxVideoOptions>({ protocol, baseURL: DEFAULT_BASE_URL, path: PATH }, input)

/** Hailuo and the `*-01` models on the v1 API. */
export const hailuoModel = (input: MediaRoute.ModelInput) =>
  VideoModel.fromRoute<MiniMaxVideoOptions>(
    { protocol: hailuoProtocol, baseURL: DEFAULT_BASE_URL, path: HAILUO_PATH },
    input,
  )

// v1 is MiniMax's legacy API with a fixed model list; every newer model ships on v2.
const isHailuo = (modelID: string) => /^(minimax-hailuo-|[tis]2v-01|video-01)/i.test(modelID)

/** Picks the API by model family: Hailuo and `*-01` models use v1, everything else v2. */
export const model = (input: MediaRoute.ModelInput) => (isHailuo(input.id) ? hailuoModel(input) : h3Model(input))

export const MiniMaxVideo = {
  protocol,
  hailuoProtocol,
  model,
  h3Model,
  hailuoModel,
} as const
