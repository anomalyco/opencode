import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/http"
import type { Status } from "../generation.js"
import { Media } from "../media.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords } from "../schema/index.js"
import { VideoModel, VideoResponse, seconds, type VideoRequest } from "../video.js"
import { ProviderShared, optionalNull } from "./shared.js"

const route = MediaProtocol.identity({ id: "openrouter-video", name: "OpenRouter Video", provider: "openrouter" })
export const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
export const PATH = "/videos"

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/**
 * Provider-native options. Common fields (`start`, `end`, `references`, `duration`, `aspect`, `resolution`, `sound`)
 * live on the request. `provider` routes the request and forwards the upstream provider's own parameters under
 * `provider.options.<slug>` (see each model's `allowed_passthrough_parameters`); `previous_job_id` edits or extends a
 * finished OpenRouter job on the same model.
 */
export type OpenRouterVideoOptions = {
  readonly provider?: {
    readonly order?: ReadonlyArray<string>
    readonly only?: ReadonlyArray<string>
    readonly ignore?: ReadonlyArray<string>
    readonly options?: Readonly<Record<string, Record<string, unknown>>>
  } & Record<string, unknown>
  readonly previous_job_id?: string
  readonly seed?: number
  readonly size?: string
  readonly callback_url?: string
  readonly user?: string
  readonly session_id?: string
} & Record<string, unknown>

export type Request = VideoRequest<VideoModel<OpenRouterVideoOptions>>

// ---------------------------------------------------------------------------
// 2. Token and response schemas
// ---------------------------------------------------------------------------

export const Token = Schema.Struct({ id: Schema.String })
export type Token = Schema.Schema.Type<typeof Token>

const StartResponse = Schema.Struct({ id: Schema.String, status: optionalNull(Schema.String) })

const Job = Schema.Struct({
  id: optionalNull(Schema.String),
  generation_id: optionalNull(Schema.String),
  status: Schema.String,
  unsigned_urls: optionalNull(Schema.Array(Schema.String)),
  expires_at: optionalNull(Schema.Number),
  error: optionalNull(Schema.String),
  usage: optionalNull(
    Schema.Struct({
      cost: optionalNull(Schema.Number),
      is_byok: optionalNull(Schema.Boolean),
    }),
  ),
})

// ---------------------------------------------------------------------------
// 3. Status
// ---------------------------------------------------------------------------

const STATUS = {
  pending: "queued",
  in_progress: "running",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  expired: "expired",
} as const satisfies Record<string, Status>

// ---------------------------------------------------------------------------
// 4. Body construction
// ---------------------------------------------------------------------------

const imagePart = (asset: Media.Asset) =>
  ProviderShared.mediaReference(asset, undefined, route.name).pipe(
    Effect.map((reference) => ({ type: "image_url", image_url: { url: reference.value } })),
  )

const referencePart = Effect.fn("OpenRouterVideo.referencePart")(function* (asset: Media.Asset) {
  // OpenRouter rejects inline video and audio ("Only HTTPS URLs are allowed", verified live); inline images work.
  if ((asset.kind === "video" || asset.kind === "audio") && asset.source.type !== "url")
    return yield* route.unsupported(
      "video.references",
      `${route.name} only takes reference ${asset.kind} as http(s) URLs`,
    )
  const reference = yield* ProviderShared.mediaReference(asset, undefined, route.name)
  if (asset.kind === "video") return { type: "video_url", video_url: { url: reference.value } }
  if (asset.kind === "audio") return { type: "audio_url", audio_url: { url: reference.value } }
  return { type: "image_url", image_url: { url: reference.value } }
})

const fromRequest = Effect.fn("OpenRouterVideo.fromRequest")(function* (request: Request) {
  const frames = [
    ...(request.start === undefined
      ? []
      : [{ ...(yield* imagePart(request.start)), frame_type: "first_frame" as const }]),
    ...(request.end === undefined ? [] : [{ ...(yield* imagePart(request.end)), frame_type: "last_frame" as const }]),
  ]
  const inputReferences = yield* Effect.forEach(request.references ?? [], referencePart)
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        model: request.model.id,
        prompt: request.prompt,
        frame_images: frames.length === 0 ? undefined : frames,
        input_references: inputReferences.length === 0 ? undefined : inputReferences,
        duration: request.duration === undefined ? undefined : seconds(request.duration),
        // Leaving the aspect ratio out is how OpenRouter follows the input image on models that can.
        aspect_ratio: request.aspect === "auto" ? undefined : request.aspect,
        resolution: request.resolution === undefined ? undefined : resolution(request.resolution),
        generate_audio: request.sound,
      },
      request.providerOptions,
      request.http?.body,
    ) ?? {},
  )
})

// OpenRouter spells the K resolutions in upper case (`1K`, `2K`, `4K`).
const resolution = (value: string) => (/^\dk$/.test(value) ? value.toUpperCase() : value)

// ---------------------------------------------------------------------------
// 5. Response decoding
// ---------------------------------------------------------------------------

const decodeStart = route.decodeStarted(StartResponse, (value) => ({
  token: { id: value.id },
  snapshot: { id: value.id, status: MediaProtocol.status(STATUS, value.status ?? "pending") },
}))

const decodeJob = route.decodeJson(Job)

const decodeStatus = Effect.fn("OpenRouterVideo.decodeStatus")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const output = yield* decodeJob(response)
  return { id: context.token.id, status: MediaProtocol.status(STATUS, output.value.status) }
})

const decodeResult = Effect.fn("OpenRouterVideo.decodeResult")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const output = yield* decodeJob(response)
  const job = output.value
  const status = MediaProtocol.status(STATUS, job.status)
  if (status === "queued" || status === "running") return yield* output.pending(context.token.id)
  if (status === "failed") {
    const message = `${route.name} generation failed${job.error ? `: ${job.error}` : ""}`
    if (job.error && /content policy|moderat/i.test(job.error)) return yield* output.contentPolicy(message)
    return yield* output.ended("failed", message)
  }
  if (status !== "completed")
    return yield* output.ended(
      status,
      `${route.name} job ${context.token.id} ${status}${job.error ? `: ${job.error}` : ""}`,
    )
  const urls = job.unsigned_urls ?? []
  if (urls.length === 0) return yield* output.invalid(`${route.name} completed without a video URL`)
  // The content URLs are OpenRouter's own and only download with the API key.
  const videos = yield* Effect.forEach(urls, (url) =>
    context.headers(url).pipe(
      Effect.map((headers) =>
        Media.url(url, {
          mediaType: "video/mp4",
          expiresAt: job.expires_at === undefined || job.expires_at === null ? undefined : job.expires_at * 1000,
          headers,
        }),
      ),
    ),
  )
  return new VideoResponse({
    videos,
    providerMetadata: {
      openrouter: {
        id: context.token.id,
        generationId: job.generation_id ?? undefined,
        cost: job.usage?.cost ?? undefined,
        isByok: job.usage?.is_byok ?? undefined,
      },
    },
  })
})

// ---------------------------------------------------------------------------
// 6. Protocol and route
// ---------------------------------------------------------------------------

const jobPath = (token: Token) => `${PATH}/${encodeURIComponent(token.id)}`

// OpenRouter has no cancel endpoint; `cancelled` only appears when it stops a job itself.
export const protocol = MediaProtocol.queued<Request, VideoResponse, Token>(route, {
  token: Token,
  start: { body: { from: fromRequest }, decode: decodeStart },
  status: { path: jobPath, decode: decodeStatus },
  result: { path: jobPath, decode: decodeResult },
})

export const model = (input: MediaRoute.ModelInput) =>
  VideoModel.fromRoute<OpenRouterVideoOptions, Token>({ protocol, baseURL: DEFAULT_BASE_URL, path: PATH }, input)

export const OpenRouterVideo = {
  protocol,
  model,
} as const
