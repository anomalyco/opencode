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
  mediaApi,
  implementation,
  Model,
  modelSchema,
  type ModelProviderOptions,
} from "./schema/index.js"
import { ImageClient, Service } from "./image-client.js"

// ---------------------------------------------------------------------------
// SelectedModel
// ---------------------------------------------------------------------------

export type ImageOptions = MediaModel.Options

export type ImageRoute = MediaRoute.AnyRoute<ImageRequest, ImageEvent, ImageResponse>

/** The number of type arguments selects the kind: `<Options>`, `<Options, Frame, State>`, or `<Options, Token>`. */
export function imageModel<Options extends ImageOptions>(
  route: MediaModel.InlineRouteInput<ImageRequest<Model<"image", Options>>, ImageResponse>,
  input: MediaRoute.ModelInput,
): Model<"image", Options>
export function imageModel<Options extends ImageOptions, Frame, State>(
  route: MediaModel.StreamRouteInput<ImageRequest<Model<"image", Options>>, ImageEvent, Frame, State>,
  input: MediaRoute.ModelInput,
): Model<"image", Options>
export function imageModel<Options extends ImageOptions, Token>(
  route: MediaModel.QueuedRouteInput<ImageRequest<Model<"image", Options>>, ImageResponse, Token>,
  input: MediaRoute.ModelInput,
): Model<"image", Options>
export function imageModel<Options extends ImageOptions, Frame, State, Token>(
  route: MediaModel.AnyRouteInput<
    ImageRequest<Model<"image", Options>>,
    ImageEvent,
    ImageResponse,
    Frame,
    State,
    Token
  >,
  input: MediaRoute.ModelInput,
) {
  return Model.make<"image", Options>({
    type: "image",
    id: input.id,
    provider: route.protocol.provider,
    options: mediaOptions(input),
    api: mediaApi(route.protocol.id),
    [implementation]: composeRoute(route, input, collectResponse) as ImageRoute,
  })
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export type ImageAspectRatio = Media.AspectRatio
export const ImageAspectRatio = Media.AspectRatio

/** Size tier: `1K` is about as many pixels as 1024×1024 at the requested aspect, `2K` as 2048×2048. */
export type ImageResolution = OpenString<"1K" | "2K" | "4K">

const ImageRequestSchema = Schema.Struct({
  model: modelSchema("image"),
  prompt: Schema.String,
  images: Schema.optional(Schema.Array(Media.AssetSchema)),
  n: Schema.optional(Schema.Int),
  aspect: Schema.optional(ImageAspectRatio),
  resolution: Schema.optional(Schema.String),
  providerOptions: Schema.optional(ProviderOptions),
})

/** A normalized image request, the plain object `ai.image.request(...)` returns. */
export interface ImageRequest<SelectedModel extends Model<"image"> = Model<"image">>
  extends BaseRequest<SelectedModel, ModelProviderOptions<SelectedModel>> {
  readonly prompt: string
  /** Edit sources or style/subject references, in order. */
  readonly images?: ReadonlyArray<Media.Asset>
  readonly n?: number
  readonly aspect?: ImageAspectRatio
  readonly resolution?: ImageResolution
}

/** Input accepted by `ai.image.request`, `generate`, `stream` and `start`. An `ImageRequest` is also a valid input. */
export type ImageRequestInput<SelectedModel extends Model<"image"> = Model<"image">> = Omit<
  ImageRequest<SelectedModel>,
  "images" | "providerOptions"
> & {
  /** Edit sources or style/subject references, in order: assets or plain data with a detectable type. */
  readonly images?: ReadonlyArray<Media.Input>
  readonly providerOptions?: NoInfer<ModelProviderOptions<SelectedModel>>
}

// ---------------------------------------------------------------------------
// Response and events
// ---------------------------------------------------------------------------

export class ImageResponse extends Schema.Class<ImageResponse>("Image.Response")({
  images: Schema.Array(Media.AssetSchema),
  usage: Schema.optional(MediaUsage),
  providerMetadata: Schema.optional(ProviderMetadata),
}) {
  get image() {
    return this.images[0]
  }
}

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
export const request = <const SelectedModel extends Model<"image">>(
  input: ImageRequestInput<SelectedModel>,
): ImageRequest<SelectedModel> => ({
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

export function generate<const SelectedModel extends Model<"image">>(
  input: ImageRequestInput<SelectedModel>,
  options?: AwaitOptions,
): Effect.Effect<ImageResponse, AIError, Service>
export function generate(input: ImageRequestInput, options?: AwaitOptions) {
  return requestEffect(input).pipe(Effect.flatMap((request) => ImageClient.generate(request, options)))
}

export function stream<const SelectedModel extends Model<"image">>(
  input: ImageRequestInput<SelectedModel>,
  options?: AwaitOptions,
): Stream.Stream<ImageEvent, AIError, Service>
export function stream(input: ImageRequestInput, options?: AwaitOptions) {
  return Stream.unwrap(requestEffect(input).pipe(Effect.map((request) => ImageClient.stream(request, options))))
}

/** Inline and streaming routes fail with `UnsupportedOperation`. */
export function start<const SelectedModel extends Model<"image">>(
  input: ImageRequestInput<SelectedModel>,
): Effect.Effect<Generation<ImageResponse>, AIError, Service>
export function start(input: ImageRequestInput) {
  return requestEffect(input).pipe(Effect.flatMap((request) => ImageClient.start(request)))
}

export const resume = (
  model: Model<"image">,
  token: unknown,
): Effect.Effect<Generation<ImageResponse>, AIError, Service> => ImageClient.resume(model, token)

export const Image = {
  request,
  generate,
  stream,
  start,
  resume,
} as const
