import { Effect, Schema, Stream } from "effect"
import { Generation, type AwaitOptions, type Event as GenerationEvent } from "./generation.js"
import { Media } from "./media.js"
import { MediaModel, composeRoute, tryRequest } from "./media-model.js"
import { MediaRoute } from "./route/media.js"
import type { MediaProtocol } from "./route/media-protocol.js"
import { AIError, HttpOptions, MediaUsage, ProviderMetadata } from "./schema/index.js"
import { VideoClient, Service } from "./video-client.js"

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type VideoOptions = Record<string, unknown>

export type VideoRoute<Options extends VideoOptions = VideoOptions> = MediaRoute.QueuedRoute<
  VideoRequestFor<Options>,
  VideoResponse
>

export class VideoModel<Options extends VideoOptions = VideoOptions> extends MediaModel<VideoRoute<Options>, Options> {
  declare protected readonly _VideoModel: void

  static make<Options extends VideoOptions = VideoOptions>(input: MediaModel.Input<VideoRoute<Options>>) {
    return new VideoModel<Options>(input)
  }

  /** Compose a queued video protocol with its canonical start path into a model for one deployment. */
  static fromRoute<Options extends VideoOptions = VideoOptions, Token = unknown>(
    route: VideoModel.RouteInput<Options, Token>,
    input: MediaRoute.ModelInput,
  ) {
    return new VideoModel<Options>({
      id: input.id,
      provider: route.provider,
      http: input.http,
      route: composeRoute(MediaRoute.queued, route, input),
    })
  }
}

export namespace VideoModel {
  export type RouteInput<Options extends VideoOptions = VideoOptions, Token = unknown> = MediaModel.RouteInput<
    VideoRequestFor<Options>,
    MediaProtocol.Queued<VideoRequestFor<Options>, VideoResponse, Token>
  >
}

export const VideoModelSchema = Schema.declare((value): value is VideoModel => value instanceof VideoModel, {
  expected: "Video.Model",
})

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export type VideoAspectRatio = Media.AspectRatio
export const VideoAspectRatio = Media.AspectRatio

export type VideoResolution = "480p" | "720p" | "1080p" | "4k" | (string & {})

/** Pinned frames. Routes that accept only a first frame fail typed when `last` is present. */
export const VideoFrames = Schema.Struct({
  first: Schema.optional(Media.AssetSchema),
  last: Schema.optional(Media.AssetSchema),
}).annotate({ identifier: "Video.Frames" })
export type VideoFrames = Schema.Schema.Type<typeof VideoFrames>

export class VideoRequest extends Schema.Class<VideoRequest>("Video.Request")({
  model: VideoModelSchema,
  prompt: Schema.String,
  frames: Schema.optional(VideoFrames),
  /** Style or subject references that guide the output without pinning a frame. */
  references: Schema.optional(Schema.Array(Media.AssetSchema)),
  /** Source video for edit or extension routes. */
  video: Schema.optional(Media.AssetSchema),
  durationSeconds: Schema.optional(Schema.Number),
  aspectRatio: Schema.optional(VideoAspectRatio),
  resolution: Schema.optional(Schema.String),
  /** Whether to generate an audio track; routes whose audio is always on fail typed on `false`. */
  audio: Schema.optional(Schema.Boolean),
  n: Schema.optional(Schema.Int),
  seed: Schema.optional(Schema.Number),
  negativePrompt: Schema.optional(Schema.String),
  providerOptions: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  http: Schema.optional(HttpOptions),
}) {
  declare protected readonly _VideoRequest: void
}

export type VideoRequestFor<Options extends VideoOptions = VideoOptions> = Omit<
  VideoRequest,
  "model" | "providerOptions"
> & {
  readonly model: VideoModel<Options>
  readonly providerOptions?: Options
}

export type VideoModelOptions<Model> = Model extends VideoModel<infer Options> ? Options : never

export type VideoRequestInput<Model extends VideoModel = VideoModel> = Omit<
  ConstructorParameters<typeof VideoRequest>[0],
  "model" | "providerOptions" | "http" | "resolution"
> & {
  readonly model: Model
  readonly resolution?: VideoResolution
  readonly providerOptions?: NoInfer<VideoModelOptions<Model>>
  readonly http?: HttpOptions.Input
}

// ---------------------------------------------------------------------------
// Response and events
// ---------------------------------------------------------------------------

export class VideoResponse extends Schema.Class<VideoResponse>("Video.Response")({
  videos: Schema.Array(Media.AssetSchema),
  usage: Schema.optional(MediaUsage),
  notices: Schema.optional(Schema.Array(Media.Notice)),
  providerMetadata: Schema.optional(ProviderMetadata),
}) {
  get video() {
    return this.videos[0]
  }
}

export const VideoQueuedEvent = Schema.Struct({
  type: Schema.tag("generation-queued"),
  id: Schema.String,
  position: Schema.optional(Schema.Number),
}).annotate({ identifier: "Video.Event.Queued" })

export const VideoProgressEvent = Schema.Struct({
  type: Schema.tag("generation-progress"),
  id: Schema.String,
  progress: Schema.optional(Schema.Number),
}).annotate({ identifier: "Video.Event.Progress" })

export const VideoOutputEvent = Schema.Struct({
  type: Schema.tag("video"),
  index: Schema.Number,
  video: Media.AssetSchema,
}).annotate({ identifier: "Video.Event.Video" })

export const VideoFinishEvent = Schema.Struct({
  type: Schema.tag("finish"),
  usage: Schema.optional(MediaUsage),
  notices: Schema.optional(Schema.Array(Media.Notice)),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "Video.Event.Finish" })

const videoEventTagged = Schema.Union([VideoQueuedEvent, VideoProgressEvent, VideoOutputEvent, VideoFinishEvent]).pipe(
  Schema.toTaggedUnion("type"),
)
export const VideoEvent = Object.assign(videoEventTagged, {
  is: {
    generationQueued: videoEventTagged.guards["generation-queued"],
    generationProgress: videoEventTagged.guards["generation-progress"],
    video: videoEventTagged.guards.video,
    finish: videoEventTagged.guards.finish,
  },
})
export type VideoEvent = Schema.Schema.Type<typeof videoEventTagged>

/** A completed response expanded into the streaming event shape. */
export const responseEvents = (response: VideoResponse): ReadonlyArray<VideoEvent> => [
  ...response.videos.map((video, index) => VideoOutputEvent.make({ index, video })),
  VideoFinishEvent.make({
    usage: response.usage,
    notices: response.notices,
    providerMetadata: response.providerMetadata,
  }),
]

/** A status observation as a video event; the terminal observation is replaced by the result events, so `none`. */
export const isObservation = (event: GenerationEvent): event is Extract<VideoEvent, { type: "generation-queued" | "generation-progress" }> =>
  event.type !== "generation-finished"

// ---------------------------------------------------------------------------
// Request-shaped call API
// ---------------------------------------------------------------------------

export function request<const Model extends VideoModel>(
  input: VideoRequestInput<Model>,
): VideoRequestFor<VideoModelOptions<Model>>
export function request(input: VideoRequest): VideoRequest
export function request(input: VideoRequest | VideoRequestInput) {
  if (input instanceof VideoRequest) return input
  return new VideoRequest({
    ...input,
    http: input.http === undefined ? undefined : HttpOptions.make(input.http),
  })
}

const requestEffect = (input: VideoRequest | VideoRequestInput) => tryRequest(() => request(input))

export function start<const Model extends VideoModel>(
  input: VideoRequestInput<Model>,
): Effect.Effect<Generation<VideoResponse>, AIError, Service>
export function start(input: VideoRequest): Effect.Effect<Generation<VideoResponse>, AIError, Service>
export function start(input: VideoRequest | VideoRequestInput) {
  return requestEffect(input).pipe(Effect.flatMap((request) => VideoClient.start(request)))
}

export function generate<const Model extends VideoModel>(
  input: VideoRequestInput<Model>,
  options?: AwaitOptions,
): Effect.Effect<VideoResponse, AIError, Service>
export function generate(input: VideoRequest, options?: AwaitOptions): Effect.Effect<VideoResponse, AIError, Service>
export function generate(input: VideoRequest | VideoRequestInput, options?: AwaitOptions) {
  return requestEffect(input).pipe(Effect.flatMap((request) => VideoClient.generate(request, options)))
}

/** Rebuild a generation handle from a persisted `Generation.token`, refreshing its status once. */
export const resume = <Options extends VideoOptions>(
  model: VideoModel<Options>,
  token: unknown,
): Effect.Effect<Generation<VideoResponse>, AIError, Service> => VideoClient.resume(model, token)

export function stream<const Model extends VideoModel>(
  input: VideoRequestInput<Model>,
  options?: AwaitOptions,
): Stream.Stream<VideoEvent, AIError, Service>
export function stream(input: VideoRequest, options?: AwaitOptions): Stream.Stream<VideoEvent, AIError, Service>
export function stream(input: VideoRequest | VideoRequestInput, options?: AwaitOptions) {
  return Stream.unwrap(requestEffect(input).pipe(Effect.map((request) => VideoClient.stream(request, options))))
}

export const Video = {
  request,
  start,
  generate,
  resume,
  stream,
} as const
