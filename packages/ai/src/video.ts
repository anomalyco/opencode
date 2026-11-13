import { Duration, Effect, Schema } from "effect"
import type { Status } from "./generation.js"
import { Media } from "./media.js"
import { MediaModel, composeQueuedRoute, tryRequest } from "./media-model.js"
import { MediaRoute } from "./route/media.js"
import {
  AIError,
  MediaUsage,
  ProviderMetadata,
  ProviderOptions,
  type OpenString,
  type BaseRequest,
} from "./schema/index.js"
import { VideoClient, Service } from "./video-client.js"

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type VideoOptions = MediaModel.Options

/** Video generation is always a queued job: submit, then read its status and result by token. */
export type VideoRoute = MediaRoute.QueuedRoute<VideoRequest, VideoResponse>

export class VideoModel<Options extends VideoOptions = VideoOptions> extends MediaModel<VideoRoute, Options> {
  declare protected readonly _VideoModel: void

  static fromRoute<Options extends VideoOptions, Token>(
    route: MediaModel.QueuedRouteInput<VideoRequest<VideoModel<Options>>, VideoResponse, Token>,
    input: MediaRoute.ModelInput,
  ) {
    return new VideoModel<Options>({
      id: input.id,
      provider: route.protocol.provider,
      http: input.http,
      providerOptions: input.providerOptions,
      route: composeQueuedRoute(route, input) as VideoRoute,
    })
  }
}

export const VideoModelSchema = Schema.declare((value): value is VideoModel => value instanceof VideoModel, {
  expected: "Video.Model",
})

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/** A `width:height` ratio, or `auto` to follow the input image. */
export type VideoAspectRatio = Media.AspectRatio | "auto"
export const VideoAspectRatio = Schema.Union([Media.AspectRatio, Schema.Literal("auto")])

/** Common output resolutions; protocols convert them to their provider's spelling and pass other values through. */
export type VideoResolution = OpenString<"480p" | "720p" | "1080p" | "4k">

/** Output length as an Effect duration string in seconds, such as `"8 seconds"`. */
export type VideoDuration = `${number} second` | `${number} seconds`
export const VideoDuration = Schema.declare<VideoDuration>(
  (value): value is VideoDuration => typeof value === "string" && /^\d+(?:\.\d+)? seconds?$/.test(value),
  { title: "Video.Duration" },
)

const VideoRequestSchema = Schema.Struct({
  model: VideoModelSchema,
  prompt: Schema.String,
  /** Image the video starts on exactly. */
  start: Schema.optional(Media.AssetSchema),
  /** Image the video ends on exactly. */
  end: Schema.optional(Media.AssetSchema),
  /** Images, videos or audio that guide the subject or style without pinning a frame. */
  references: Schema.optional(Schema.Array(Media.AssetSchema)),
  duration: Schema.optional(VideoDuration),
  aspect: Schema.optional(VideoAspectRatio),
  resolution: Schema.optional(Schema.String),
  /** Whether the video has a generated soundtrack; unset leaves the model's default. */
  sound: Schema.optional(Schema.Boolean),
  providerOptions: Schema.optional(ProviderOptions),
})

/** A normalized video request, the plain object `ai.video.request(...)` returns. */
export type VideoRequest<Model extends VideoModel = VideoModel> = Omit<
  typeof VideoRequestSchema.Type,
  "model" | "providerOptions" | "resolution"
> &
  BaseRequest<Model, VideoModelOptions<Model>> & { readonly resolution?: VideoResolution }

export type VideoModelOptions<Model> = Model extends VideoModel<infer Options> ? Options : never

/** Input accepted by `ai.video.request` and `ai.video.start`; a `VideoRequest` is also a valid input. */
export type VideoRequestInput<Model extends VideoModel = VideoModel> = Omit<
  VideoRequest<Model>,
  "start" | "end" | "references" | "providerOptions"
> & {
  readonly start?: Media.Input
  readonly end?: Media.Input
  readonly references?: ReadonlyArray<Media.Input>
  readonly providerOptions?: NoInfer<VideoModelOptions<Model>>
}

/** Seconds in a request's `duration`, for protocols that send a number. */
export const seconds = (duration: VideoDuration) => Duration.toSeconds(Duration.fromInputUnsafe(duration))

// ---------------------------------------------------------------------------
// Job, status and response
// ---------------------------------------------------------------------------

/** A submitted generation. Store `token` (plain JSON) with the model to read the job later, from any process. */
export interface VideoJob {
  readonly id: string
  readonly token: unknown
}

export interface VideoStatus {
  readonly status: Status
  /** 0..1, only when the provider reports progress. */
  readonly progress?: number
}

export class VideoResponse extends Schema.Class<VideoResponse>("Video.Response")({
  videos: Schema.Array(Media.AssetSchema),
  usage: Schema.optional(MediaUsage),
  providerMetadata: Schema.optional(ProviderMetadata),
}) {
  get video() {
    return this.videos[0]
  }
}

// ---------------------------------------------------------------------------
// Call API
// ---------------------------------------------------------------------------

/** Normalize video request input into a plain `VideoRequest`. */
export const request = <const Model extends VideoModel>(input: VideoRequestInput<Model>): VideoRequest<Model> => ({
  ...input,
  start: input.start === undefined ? undefined : Media.make(input.start),
  end: input.end === undefined ? undefined : Media.make(input.end),
  references: input.references?.map((reference) => Media.make(reference)),
})

const validate = Schema.decodeUnknownSync(VideoRequestSchema)

const requestEffect = (input: VideoRequestInput) =>
  tryRequest(() => {
    const normalized = request(input)
    validate(normalized)
    return normalized
  })

/** Submit a generation and return at once; nothing polls. */
export function start<const Model extends VideoModel>(
  input: VideoRequestInput<Model>,
): Effect.Effect<VideoJob, AIError, Service>
export function start(input: VideoRequestInput) {
  return requestEffect(input).pipe(Effect.flatMap((request) => VideoClient.start(request)))
}

/** One status read for a stored token. */
export const status = (model: VideoModel, token: unknown): Effect.Effect<VideoStatus, AIError, Service> =>
  VideoClient.status(model, token)

/** The finished videos; fails while the job is still running, or with the provider's reason when it failed. */
export const result = (model: VideoModel, token: unknown): Effect.Effect<VideoResponse, AIError, Service> =>
  VideoClient.result(model, token)

/** Ask the provider to stop the job; fails with `UnsupportedOperation` when the provider has no cancel call. */
export const cancel = (model: VideoModel, token: unknown): Effect.Effect<void, AIError, Service> =>
  VideoClient.cancel(model, token)

export const Video = {
  request,
  start,
  status,
  result,
  cancel,
} as const
