import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"
import type { Status } from "../generation.js"
import { Media } from "../media.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { ProviderID, mergeJsonRecords } from "../schema/index.js"
import { VideoModel, VideoResponse, type VideoRequestFor } from "../video.js"
import { ProviderShared, optionalNull } from "./shared.js"

const ADAPTER = "fal-video"
const NAME = "fal Video"
const PROVIDER = ProviderID.make("fal")
export const DEFAULT_BASE_URL = "https://queue.fal.run"

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

export type FalVideoString<Known extends string> = Known | (string & {})

/**
 * Provider-native input. fal video endpoints are model-specific: `duration` is a string enum whose values differ per
 * model (`"8s"` for Veo, `"5"` for Kling), and last-frame fields are named per model (`end_image_url`,
 * `last_frame_url`, `tail_image_url`), so those pass through here instead of lowering from common fields.
 */
export type FalVideoOptions = {
  readonly duration?: FalVideoString<"4s" | "6s" | "8s" | "5" | "10">
} & Record<string, unknown>

export type Request = VideoRequestFor<FalVideoOptions>

// ---------------------------------------------------------------------------
// 2. Token and response schemas
// ---------------------------------------------------------------------------

/** fal hands back absolute follow-up URLs on submit; they are authoritative for status, result, and cancel. */
export const Token = Schema.Struct({
  requestID: Schema.String,
  statusURL: Schema.String,
  responseURL: Schema.String,
  cancelURL: Schema.String,
})
export type Token = Schema.Schema.Type<typeof Token>

const StartResponse = Schema.Struct({
  request_id: Schema.String,
  status_url: Schema.String,
  response_url: Schema.String,
  cancel_url: Schema.String,
  queue_position: optionalNull(Schema.Number),
})

const QueueStatus = Schema.Struct({
  status: Schema.String,
  queue_position: optionalNull(Schema.Number),
  error: optionalNull(Schema.Unknown),
})

const QueueResult = Schema.StructWithRest(
  Schema.Struct({
    video: Schema.Struct({
      url: Schema.String,
      content_type: optionalNull(Schema.String),
      file_name: optionalNull(Schema.String),
      file_size: optionalNull(Schema.Number),
    }),
    seed: optionalNull(Schema.Number),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

const STATUS = {
  IN_QUEUE: "queued",
  IN_PROGRESS: "running",
  COMPLETED: "completed",
} as const satisfies Record<string, Status>

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

// fal accepts public URLs and data URIs; there is no provider file handle to forward.
const mediaUrl = (asset: Media.Asset) =>
  ProviderShared.mediaReference(asset, undefined, NAME).pipe(Effect.map((reference) => reference.value))

const fromRequest = Effect.fn("FalVideo.fromRequest")(function* (request: Request) {
  if (request.frames?.last !== undefined)
    return yield* ProviderShared.unsupportedOperation({
      operation: "video.frames.last",
      provider: PROVIDER,
      route: ADAPTER,
      message: `${NAME} names the last frame per model; pass it through providerOptions (e.g. end_image_url) instead of frames.last`,
    })
  const imageUrl = request.frames?.first === undefined ? undefined : yield* mediaUrl(request.frames.first)
  const videoUrl = request.video === undefined ? undefined : yield* mediaUrl(request.video)
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        prompt: request.prompt,
        negative_prompt: request.negativePrompt,
        seed: request.seed,
        aspect_ratio: request.aspectRatio,
        resolution: request.resolution,
        generate_audio: request.audio,
        image_url: imageUrl,
        video_url: videoUrl,
      },
      request.providerOptions,
      request.http?.body,
    ) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodeStart = MediaProtocol.decodeStarted(ADAPTER, NAME, StartResponse, (value) => ({
  token: {
    requestID: value.request_id,
    statusURL: value.status_url,
    responseURL: value.response_url,
    cancelURL: value.cancel_url,
  },
  snapshot: { id: value.request_id, status: "queued", position: value.queue_position ?? undefined },
}))

const decodeQueueStatus = MediaProtocol.decodeJson(ADAPTER, NAME, QueueStatus)
const decodeQueueResult = MediaProtocol.decodeJson(ADAPTER, NAME, QueueResult)

const decodeStatus = Effect.fn("FalVideo.decodeStatus")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const output = yield* decodeQueueStatus(response)
  const decoded = output.value
  const status = yield* MediaProtocol.status(STATUS, decoded.status, output)
  // fal reports request failures as COMPLETED with an `error`; the response endpoint carries the details.
  const failed = status === "completed" && decoded.error !== undefined && decoded.error !== null
  return {
    id: context.token.requestID,
    status: failed ? "failed" : status,
    position: status === "queued" ? (decoded.queue_position ?? undefined) : undefined,
  }
})

const decodeResult = Effect.fn("FalVideo.decodeResult")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const output = yield* decodeQueueResult(response)
  const { video, seed, ...rest } = output.value
  return new VideoResponse({
    videos: [Media.url(video.url, { mediaType: video.content_type ?? "video/mp4" })],
    providerMetadata: {
      fal: {
        requestId: context.token.requestID,
        seed: seed ?? undefined,
        fileName: video.file_name ?? undefined,
        fileSize: video.file_size ?? undefined,
        ...rest,
      },
    },
  })
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.queued<Request, VideoResponse, Token>({
  id: ADAPTER,
  name: NAME,
  token: Token,
  unsupported: ["n", "durationSeconds", "references"],
  start: { body: { from: fromRequest }, decode: decodeStart },
  status: { path: (token) => token.statusURL, decode: decodeStatus },
  result: { path: (token) => token.responseURL, decode: decodeResult },
  cancel: { method: "PUT", path: (token) => token.cancelURL },
})

export const model = (input: MediaRoute.ModelInput) =>
  VideoModel.fromRoute<FalVideoOptions, Token>(
    {
      id: ADAPTER,
      provider: PROVIDER,
      protocol,
      baseURL: DEFAULT_BASE_URL,
      path: ({ request }) => `/${request.model.id}`,
    },
    input,
  )

export const FalVideo = {
  protocol,
  model,
} as const
