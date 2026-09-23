import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"
import { Media } from "../media.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { ProviderID, mergeJsonRecords } from "../schema/index.js"
import { VideoModel, VideoResponse, type VideoRequestFor } from "../video.js"
import { ProviderShared, optionalNull } from "./shared.js"
import { FalQueue } from "./utils/fal-queue.js"

const ADAPTER = "fal-video"
const NAME = "fal Video"
const PROVIDER = ProviderID.make("fal")

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
// 2. Response schema
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

const fromRequest = Effect.fn("FalVideo.fromRequest")(function* (request: Request) {
  if (request.frames?.last !== undefined)
    return yield* ProviderShared.unsupportedOperation({
      operation: "video.frames.last",
      provider: PROVIDER,
      route: ADAPTER,
      message: `${NAME} names the last frame per model; pass it through providerOptions (e.g. end_image_url) instead of frames.last`,
    })
  const imageUrl =
    request.frames?.first === undefined ? undefined : yield* FalQueue.mediaUrl(request.frames.first, NAME)
  const videoUrl = request.video === undefined ? undefined : yield* FalQueue.mediaUrl(request.video, NAME)
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

const decodeQueueResult = MediaProtocol.decodeJson(ADAPTER, NAME, QueueResult)

const decodeResult = Effect.fn("FalVideo.decodeResult")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<FalQueue.Token>,
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

export const protocol = FalQueue.protocol<Request, VideoResponse>({
  id: ADAPTER,
  name: NAME,
  unsupported: ["n", "durationSeconds", "references"],
  from: fromRequest,
  decodeResult,
})

export const model = (input: MediaRoute.ModelInput) =>
  VideoModel.fromRoute<FalVideoOptions, FalQueue.Token>(
    {
      id: ADAPTER,
      provider: PROVIDER,
      protocol,
      baseURL: FalQueue.DEFAULT_BASE_URL,
      path: ({ request }) => `/${request.model.id}`,
    },
    input,
  )

export const FalVideo = {
  protocol,
  model,
} as const
