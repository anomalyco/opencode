import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/http"
import type { Status } from "../generation.js"
import { Media } from "../media.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords } from "../schema/index.js"
import { VideoModel, VideoResponse, seconds, type VideoRequest } from "../video.js"
import { ProviderShared, optionalNull } from "./shared.js"

const route = MediaProtocol.identity({ id: "xai-video", name: "xAI Video", provider: "xai" })
export const DEFAULT_BASE_URL = "https://api.x.ai/v1"
export const PATH = "/videos/generations"
export const EDIT_PATH = "/videos/edits"
export const EXTEND_PATH = "/videos/extensions"
export const STATUS_PATH = "/videos"

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/**
 * Provider-native options. Common fields (`start`, `end`, `references`, `duration`, `aspect`, `resolution`,
 * `sound`) live on the request. `mode` sends the request to the edit or extension endpoint with a native
 * `video: { url }` source; `reference_audios` takes preset `voice_id`s.
 */
export type XAIVideoOptions = {
  readonly mode?: "edit" | "extend"
  readonly video?: { readonly url: string } | { readonly file_id: string }
  readonly reference_audios?: ReadonlyArray<{ readonly voice_id: string }>
} & Record<string, unknown>

export type Request = VideoRequest<VideoModel<XAIVideoOptions>>

// ---------------------------------------------------------------------------
// 2. Token and response schemas
// ---------------------------------------------------------------------------

/** The provider's job ID; it is all a later status, result or cancel call needs. */
export const Token = Schema.String
export type Token = Schema.Schema.Type<typeof Token>

const StartResponse = Schema.Struct({ request_id: Schema.String })

const VideoStatus = Schema.Struct({
  status: Schema.String,
  progress: optionalNull(Schema.Number),
  video: optionalNull(
    Schema.Struct({
      url: optionalNull(Schema.String),
      duration: optionalNull(Schema.Number),
      respect_moderation: optionalNull(Schema.Boolean),
    }),
  ),
  error: optionalNull(
    Schema.Struct({
      code: optionalNull(Schema.String),
      message: optionalNull(Schema.String),
    }),
  ),
  model: optionalNull(Schema.String),
})

const STATUS = {
  pending: "running",
  done: "completed",
  failed: "failed",
  expired: "expired",
} as const satisfies Record<string, Status>

// Documented video error codes; `service_unavailable`, `internal_error`, and unknown codes are provider-side.
const FAILURE = {
  invalid_argument: "InvalidRequest",
  failed_precondition: "InvalidRequest",
  permission_denied: "Authentication",
} as const satisfies Record<string, MediaProtocol.Failure>

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

const mediaInput = (asset: Media.Asset) =>
  ProviderShared.mediaReference(asset, route.provider, route.name).pipe(
    Effect.map((reference) => (reference.type === "ref" ? { file_id: reference.value } : { url: reference.value })),
  )

const nativeOptions = (options: XAIVideoOptions | undefined) => {
  if (!options) return undefined
  const { mode: _mode, ...native } = options
  return native
}

const fromRequest = Effect.fn("XAIVideo.fromRequest")(function* (request: Request) {
  const references = request.references ?? []
  if (references.some((asset) => asset.kind === "video"))
    return yield* route.unsupported("video.references", `${route.name} has no reference video input`)
  const image = request.start === undefined ? undefined : yield* mediaInput(request.start)
  const lastFrame = request.end === undefined ? undefined : yield* mediaInput(request.end)
  const images = yield* Effect.forEach(
    references.filter((asset) => asset.kind !== "audio"),
    mediaInput,
  )
  const audios = yield* Effect.forEach(
    references.filter((asset) => asset.kind === "audio"),
    (asset) =>
      ProviderShared.mediaReference(asset, route.provider, route.name).pipe(
        Effect.map((reference) => ({ url: reference.value })),
      ),
  )
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        model: request.model.id,
        prompt: request.prompt,
        image,
        last_frame: lastFrame,
        reference_images: images.length === 0 ? undefined : images,
        reference_audios: audios.length === 0 ? undefined : audios,
        duration: request.duration === undefined ? undefined : seconds(request.duration),
        // xAI follows the input image's shape when a start frame is set, which is what `auto` asks for.
        aspect_ratio: request.aspect === "auto" && request.start !== undefined ? undefined : request.aspect,
        resolution: request.resolution,
        generate_audio: request.sound,
      },
      nativeOptions(request.providerOptions),
      request.http?.body,
    ) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodeStart = route.decodeStarted(StartResponse, (value) => ({
  token: value.request_id,
  snapshot: { id: value.request_id, status: "running" },
}))

// `progress` is undocumented but observed live as a 0..100 percentage (recorded cassette: 1 → 10 → 37 → 100).
const fraction = (progress: number | null | undefined) =>
  progress !== undefined && progress !== null && progress >= 0 && progress <= 100 ? progress / 100 : undefined

const decodeVideoStatus = route.decodeJson(VideoStatus)

const decodeStatus = Effect.fn("XAIVideo.decodeStatus")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const output = yield* decodeVideoStatus(response)
  const status = MediaProtocol.status(STATUS, output.value.status)
  return { id: context.token, status, progress: fraction(output.value.progress) }
})

const decodeResult = Effect.fn("XAIVideo.decodeResult")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const output = yield* decodeVideoStatus(response)
  const decoded = output.value
  const status = MediaProtocol.status(STATUS, decoded.status)
  if (status === "running") return yield* output.pending(context.token)
  if (status === "failed") {
    const code = decoded.error?.code ?? undefined
    const message = decoded.error?.message ?? undefined
    return yield* output.ended(
      "failed",
      `${route.name} generation failed${code === undefined ? "" : ` (${code})`}${message === undefined ? "" : `: ${message}`}`,
      MediaProtocol.failure(FAILURE, code),
    )
  }
  if (status !== "completed") return yield* output.ended("expired", `${route.name} request ${context.token} expired`)
  // `respect_moderation: false` marks a filtered result; a URL may still be present, so only a missing one fails.
  const moderated = decoded.video?.respect_moderation === false
  const url = decoded.video?.url ?? undefined
  if (url === undefined && moderated)
    return yield* output.contentPolicy(`${route.name} withheld the video for moderation`)
  if (url === undefined) return yield* output.invalid(`${route.name} completed without a video URL`)
  const duration = decoded.video?.duration ?? undefined
  return new VideoResponse({
    videos: [
      Media.url(url, {
        mediaType: "video/mp4",
        info: duration === undefined ? undefined : { durationSeconds: duration },
      }),
    ],
    providerMetadata: {
      xai: {
        requestId: context.token,
        model: decoded.model ?? undefined,
        respectModeration: decoded.video?.respect_moderation ?? undefined,
      },
    },
  })
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

const statusPath = (token: Token) => `${STATUS_PATH}/${encodeURIComponent(token)}`

export const protocol = MediaProtocol.queued<Request, VideoResponse, Token>(route, {
  token: Token,
  start: { body: { from: fromRequest }, decode: decodeStart },
  status: { path: statusPath, decode: decodeStatus },
  result: { path: statusPath, decode: decodeResult },
})

// `providerOptions.mode` sends the native `video` source to the edit or extension endpoint.
const startPath = (request: Request) => {
  if (request.providerOptions?.mode === "edit") return EDIT_PATH
  if (request.providerOptions?.mode === "extend") return EXTEND_PATH
  return PATH
}

export const model = (input: MediaRoute.ModelInput) =>
  VideoModel.fromRoute<XAIVideoOptions>(
    {
      protocol,
      baseURL: DEFAULT_BASE_URL,
      path: ({ request }) => startPath(request),
    },
    input,
  )

export const XAIVideo = {
  protocol,
  model,
} as const
