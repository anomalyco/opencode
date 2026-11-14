import { Effect, Schema, Stream } from "effect"
import { ProgressEvent, QueuedEvent, type AwaitOptions, type Status } from "./generation.js"
import { Media } from "./media.js"
import { MediaModel, composeRoute, tryRequest } from "./media-model.js"
import { MediaRoute } from "./route/media.js"
import {
  AIError,
  MediaUsage,
  ProviderMetadata,
  ProviderOptions,
  type OpenString,
  type BaseRequest,
} from "./schema/index.js"
import { ImageClient, Service } from "./image-client.js"

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type ImageOptions = MediaModel.Options

export type ImageRoute = MediaRoute.AnyRoute<ImageRequest, ImageEvent, ImageResponse>

export class ImageModel<Options extends ImageOptions = ImageOptions> extends MediaModel<ImageRoute, Options> {
  declare protected readonly _ImageModel: void

  /**
   * The number of type arguments selects the kind: `<Options>` for inline or queued, `<Options, Frame, State>` for
   * stream. A queued route's token is the provider's job ID, so `ImageJob.id` is exactly what `status` and `result` take.
   */
  static fromRoute<Options extends ImageOptions>(
    route: MediaModel.InlineRouteInput<ImageRequest<ImageModel<Options>>, ImageResponse>,
    input: MediaRoute.ModelInput,
  ): ImageModel<Options>
  static fromRoute<Options extends ImageOptions, Frame, State>(
    route: MediaModel.StreamRouteInput<ImageRequest<ImageModel<Options>>, ImageEvent, Frame, State>,
    input: MediaRoute.ModelInput,
  ): ImageModel<Options>
  static fromRoute<Options extends ImageOptions>(
    route: MediaModel.QueuedRouteInput<ImageRequest<ImageModel<Options>>, ImageResponse, string>,
    input: MediaRoute.ModelInput,
  ): ImageModel<Options>
  static fromRoute<Options extends ImageOptions, Frame, State>(
    route: MediaModel.AnyRouteInput<ImageRequest<ImageModel<Options>>, ImageEvent, ImageResponse, Frame, State, string>,
    input: MediaRoute.ModelInput,
  ) {
    return new ImageModel<Options>({
      id: input.id,
      provider: route.protocol.provider,
      http: input.http,
      providerOptions: input.providerOptions,
      route: composeRoute(route, input, collectResponse) as ImageRoute,
    })
  }
}

export const ImageModelSchema = Schema.declare((value): value is ImageModel => value instanceof ImageModel, {
  expected: "Image.Model",
})

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export type ImageAspectRatio = Media.AspectRatio
export const ImageAspectRatio = Media.AspectRatio

/** Size tier: `1K` is about as many pixels as 1024×1024 at the requested aspect, `2K` as 2048×2048. */
export type ImageResolution = OpenString<"1K" | "2K" | "4K">

const ImageRequestSchema = Schema.Struct({
  model: ImageModelSchema,
  prompt: Schema.String,
  images: Schema.optional(Schema.Array(Media.AssetSchema)),
  n: Schema.optional(Schema.Int),
  aspect: Schema.optional(ImageAspectRatio),
  resolution: Schema.optional(Schema.String),
  providerOptions: Schema.optional(ProviderOptions),
})

/** A normalized image request, the plain object `ai.image.request(...)` returns. */
export interface ImageRequest<Model extends ImageModel = ImageModel>
  extends BaseRequest<Model, ImageModelOptions<Model>> {
  readonly prompt: string
  /** Edit sources or style/subject references, in order. */
  readonly images?: ReadonlyArray<Media.Asset>
  readonly n?: number
  readonly aspect?: ImageAspectRatio
  readonly resolution?: ImageResolution
}

export type ImageModelOptions<Model> = Model extends ImageModel<infer Options> ? Options : never

/** Input accepted by `ai.image.request`, `generate`, `stream` and `start`. An `ImageRequest` is also a valid input. */
export type ImageRequestInput<Model extends ImageModel = ImageModel> = Omit<
  ImageRequest<Model>,
  "images" | "providerOptions"
> & {
  /** Edit sources or style/subject references, in order: assets or plain data with a detectable type. */
  readonly images?: ReadonlyArray<Media.Input>
  readonly providerOptions?: NoInfer<ImageModelOptions<Model>>
}

// ---------------------------------------------------------------------------
// Job, status, response and events
// ---------------------------------------------------------------------------

/** A submitted generation on a queued route. Store `id` with the model to read the job later, from any process. */
export interface ImageJob {
  /** The provider's job ID. */
  readonly id: string
}

export interface ImageStatus {
  readonly status: Status
  /** 0..1, only when the provider reports progress. */
  readonly progress?: number
}

export class ImageResponse extends Schema.Class<ImageResponse>("Image.Response")({
  images: Schema.Array(Media.AssetSchema),
  usage: Schema.optional(MediaUsage),
  providerMetadata: Schema.optional(ProviderMetadata),
}) {}

/** The `index`-th lower-fidelity preview of an image still generating; the `image` event supersedes it. */
export const ImagePartialEvent = Schema.Struct({
  type: Schema.tag("image-partial"),
  index: Schema.Number,
  image: Media.AssetSchema,
}).annotate({ identifier: "Image.Event.Partial" })

export const ImageOutputEvent = Schema.Struct({
  type: Schema.tag("image"),
  index: Schema.Number,
  image: Media.AssetSchema,
}).annotate({ identifier: "Image.Event.Image" })

export const ImageFinishEvent = Schema.Struct({
  type: Schema.tag("finish"),
  usage: Schema.optional(MediaUsage),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "Image.Event.Finish" })

const imageEventTagged = Schema.Union([
  QueuedEvent,
  ProgressEvent,
  ImagePartialEvent,
  ImageOutputEvent,
  ImageFinishEvent,
]).pipe(Schema.toTaggedUnion("type"))
export const ImageEvent = Object.assign(imageEventTagged, {
  is: {
    generationQueued: imageEventTagged.guards["generation-queued"],
    generationProgress: imageEventTagged.guards["generation-progress"],
    imagePartial: imageEventTagged.guards["image-partial"],
    image: imageEventTagged.guards.image,
    finish: imageEventTagged.guards.finish,
  },
})
export type ImageEvent = Schema.Schema.Type<typeof imageEventTagged>

const collectResponse = (events: ReadonlyArray<ImageEvent>): Effect.Effect<ImageResponse> => {
  const finish = events.find(ImageEvent.is.finish)
  // Every image protocol's `finish` emits the terminal event or fails, so a completed stream always has one.
  if (finish === undefined) return Effect.die(new Error("The image stream completed without a finish event"))
  return Effect.succeed(
    new ImageResponse({
      images: events.filter(ImageEvent.is.image).map((event) => event.image),
      usage: finish.usage,
      providerMetadata: finish.providerMetadata,
    }),
  )
}

// ---------------------------------------------------------------------------
// Request-shaped call API
// ---------------------------------------------------------------------------

/** Normalize image request input into a plain `ImageRequest`. */
export const request = <const Model extends ImageModel>(input: ImageRequestInput<Model>): ImageRequest<Model> => ({
  ...input,
  images: input.images?.map((image) => Media.make(image)),
})

const validate = Schema.decodeUnknownSync(ImageRequestSchema)

const requestEffect = (input: ImageRequestInput) =>
  tryRequest(() => {
    const normalized = request(input)
    validate(normalized)
    return normalized
  })

export function generate<const Model extends ImageModel>(
  input: ImageRequestInput<Model>,
  options?: AwaitOptions,
): Effect.Effect<ImageResponse, AIError, Service>
export function generate(input: ImageRequestInput, options?: AwaitOptions) {
  return requestEffect(input).pipe(Effect.flatMap((request) => ImageClient.generate(request, options)))
}

export function stream<const Model extends ImageModel>(
  input: ImageRequestInput<Model>,
  options?: AwaitOptions,
): Stream.Stream<ImageEvent, AIError, Service>
export function stream(input: ImageRequestInput, options?: AwaitOptions) {
  return Stream.unwrap(requestEffect(input).pipe(Effect.map((request) => ImageClient.stream(request, options))))
}

/** Submit a generation and return at once; nothing polls. Inline and stream routes fail with `UnsupportedOperation`. */
export function start<const Model extends ImageModel>(
  input: ImageRequestInput<Model>,
): Effect.Effect<ImageJob, AIError, Service>
export function start(input: ImageRequestInput) {
  return requestEffect(input).pipe(Effect.flatMap((request) => ImageClient.start(request)))
}

/** One status read for a job ID. */
export const status = (model: ImageModel, id: string): Effect.Effect<ImageStatus, AIError, Service> =>
  ImageClient.status(model, id)

/** The finished images; fails while the job is still running, or with the provider's reason when it failed. */
export const result = (model: ImageModel, id: string): Effect.Effect<ImageResponse, AIError, Service> =>
  ImageClient.result(model, id)

/** Ask the provider to stop the job; fails with `UnsupportedOperation` when the provider has no cancel call. */
export const cancel = (model: ImageModel, id: string): Effect.Effect<void, AIError, Service> =>
  ImageClient.cancel(model, id)

export const Image = {
  request,
  generate,
  stream,
  start,
  status,
  result,
  cancel,
} as const
