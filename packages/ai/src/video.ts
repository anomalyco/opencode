import { Effect, Schema, Stream } from "effect"
import { Generation, ProgressEvent, QueuedEvent, type AwaitOptions } from "./generation.js"
import { Media } from "./media.js"
import { type MediaModel, composeRoute, mediaOptions, tryRequest } from "./media-model.js"
import { MediaRoute } from "./route/media.js"
import {
  AIError,
  MediaUsage,
  ProviderMetadata,
  ProviderOptions,
  type OpenString,
  type BaseRequest,
  Model,
  type ModelProviderOptions,
} from "./schema/index.js"
import { VideoClient, Service } from "./video-client.js"

// ---------------------------------------------------------------------------
// SelectedModel
// ---------------------------------------------------------------------------

export type VideoOptions = MediaModel.Options

export type VideoRoute = MediaRoute.AnyRoute<VideoRequest, VideoEvent, VideoResponse>

/** The number of type arguments selects the kind: `<Options>`, `<Options, Frame, State>`, or `<Options, Token>`. */
export function videoModel<Options extends VideoOptions>(
  route: MediaModel.InlineRouteInput<VideoRequest<Model<"video", Options>>, VideoResponse>,
  input: MediaRoute.ModelInput,
): Model<"video", Options>
export function videoModel<Options extends VideoOptions, Frame, State>(
  route: MediaModel.StreamRouteInput<VideoRequest<Model<"video", Options>>, VideoEvent, Frame, State>,
  input: MediaRoute.ModelInput,
): Model<"video", Options>
export function videoModel<Options extends VideoOptions, Token>(
  route: MediaModel.QueuedRouteInput<VideoRequest<Model<"video", Options>>, VideoResponse, Token>,
  input: MediaRoute.ModelInput,
): Model<"video", Options>
export function videoModel<Options extends VideoOptions, Frame, State, Token>(
  route: MediaModel.AnyRouteInput<
    VideoRequest<Model<"video", Options>>,
    VideoEvent,
    VideoResponse,
    Frame,
    State,
    Token
  >,
  input: MediaRoute.ModelInput,
) {
  return Model.make<"video", Options>({
    type: "video",
    id: input.id,
    provider: route.protocol.provider,
    options: mediaOptions(input),
    api: composeRoute(route, input, collectResponse) as VideoRoute,
  })
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export type VideoAspectRatio = Media.AspectRatio
export const VideoAspectRatio = Media.AspectRatio

export type VideoResolution = OpenString<"480p" | "720p" | "1080p" | "4k">

/** Pinned frames. Routes that accept only a first frame fail typed when `last` is present. */
export const VideoFrames = Schema.Struct({
  first: Schema.optional(Media.AssetSchema),
  last: Schema.optional(Media.AssetSchema),
}).annotate({ identifier: "Video.Frames" })
export type VideoFrames = Schema.Schema.Type<typeof VideoFrames>

const VideoRequestSchema = Schema.Struct({
  model: Model.schema("video"),
  prompt: Schema.String,
  frames: Schema.optional(VideoFrames),
  /** Style or subject references that guide the output without pinning a frame. */
  references: Schema.optional(Schema.Array(Media.AssetSchema)),
  /** Source video for edit or extension routes. */
  video: Schema.optional(Media.AssetSchema),
  durationSeconds: Schema.optional(Schema.Number),
  aspect: Schema.optional(VideoAspectRatio),
  resolution: Schema.optional(Schema.String),
  /** Whether to generate an audio track; routes whose audio is always on fail typed on `false`. */
  audio: Schema.optional(Schema.Boolean),
  n: Schema.optional(Schema.Int),
  seed: Schema.optional(Schema.Number),
  negativePrompt: Schema.optional(Schema.String),
  providerOptions: Schema.optional(ProviderOptions),
})

/** A normalized video request, the plain object `Video.request(...)` returns. */
export type VideoRequest<SelectedModel extends Model<"video"> = Model<"video">> = Omit<
  typeof VideoRequestSchema.Type,
  "model" | "providerOptions" | "resolution"
> &
  BaseRequest<SelectedModel, ModelProviderOptions<SelectedModel>> & { readonly resolution?: VideoResolution }

/** Input accepted by `Video.request` and the calls; a `VideoRequest` is also a valid input. */
export type VideoRequestInput<SelectedModel extends Model<"video"> = Model<"video">> = Omit<
  VideoRequest<SelectedModel>,
  "providerOptions"
> & {
  readonly providerOptions?: NoInfer<ModelProviderOptions<SelectedModel>>
}

// ---------------------------------------------------------------------------
// Response and events
// ---------------------------------------------------------------------------

export class VideoResponse extends Schema.Class<VideoResponse>("Video.Response")({
  videos: Schema.Array(Media.AssetSchema),
  usage: Schema.optional(MediaUsage),
  providerMetadata: Schema.optional(ProviderMetadata),
}) {
  get video() {
    return this.videos[0]
  }
}

export const VideoOutputEvent = Schema.Struct({
  type: Schema.tag("video"),
  index: Schema.Number,
  video: Media.AssetSchema,
}).annotate({ identifier: "Video.Event.Video" })

export const VideoFinishEvent = Schema.Struct({
  type: Schema.tag("finish"),
  usage: Schema.optional(MediaUsage),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "Video.Event.Finish" })

const videoEventTagged = Schema.Union([QueuedEvent, ProgressEvent, VideoOutputEvent, VideoFinishEvent]).pipe(
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

const collectResponse = (events: ReadonlyArray<VideoEvent>): Effect.Effect<VideoResponse> => {
  const finish = events.find(VideoEvent.is.finish)
  // A streaming video protocol's `finish` emits the terminal event or fails, so a completed stream always has one.
  if (finish === undefined) return Effect.die(new Error("The video stream completed without a finish event"))
  return Effect.succeed(
    new VideoResponse({
      videos: events.filter(VideoEvent.is.video).map((event) => event.video),
      usage: finish.usage,
      providerMetadata: finish.providerMetadata,
    }),
  )
}

// ---------------------------------------------------------------------------
// Request-shaped call API
// ---------------------------------------------------------------------------

/** Normalize video request input into a plain `VideoRequest`. */
export const request = <const SelectedModel extends Model<"video">>(
  input: VideoRequestInput<SelectedModel>,
): VideoRequest<SelectedModel> => ({
  ...input,
})

const validate = Schema.decodeUnknownSync(VideoRequestSchema)

const requestEffect = (input: VideoRequestInput) =>
  tryRequest(() => {
    const normalized = request(input)
    validate(normalized)
    return normalized
  })

export function start<const SelectedModel extends Model<"video">>(
  input: VideoRequestInput<SelectedModel>,
): Effect.Effect<Generation<VideoResponse>, AIError, Service>
export function start(input: VideoRequestInput) {
  return requestEffect(input).pipe(Effect.flatMap((request) => VideoClient.start(request)))
}

export function generate<const SelectedModel extends Model<"video">>(
  input: VideoRequestInput<SelectedModel>,
  options?: AwaitOptions,
): Effect.Effect<VideoResponse, AIError, Service>
export function generate(input: VideoRequestInput, options?: AwaitOptions) {
  return requestEffect(input).pipe(Effect.flatMap((request) => VideoClient.generate(request, options)))
}

/** Rebuild a generation handle from a persisted `Generation.token`, refreshing its status once. */
export const resume = (
  model: Model<"video">,
  token: unknown,
): Effect.Effect<Generation<VideoResponse>, AIError, Service> => VideoClient.resume(model, token)

export function stream<const SelectedModel extends Model<"video">>(
  input: VideoRequestInput<SelectedModel>,
  options?: AwaitOptions,
): Stream.Stream<VideoEvent, AIError, Service>
export function stream(input: VideoRequestInput, options?: AwaitOptions) {
  return Stream.unwrap(requestEffect(input).pipe(Effect.map((request) => VideoClient.stream(request, options))))
}

export const Video = {
  request,
  start,
  generate,
  resume,
  stream,
} as const
