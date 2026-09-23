import { Effect, Schema, Stream } from "effect"
import { Media } from "./media.js"
import { MediaModel, composeRoute, tryRequest } from "./media-model.js"
import { MediaRoute } from "./route/media.js"
import type { MediaProtocol } from "./route/media-protocol.js"
import { AIError, HttpOptions, MediaUsage, ProviderMetadata } from "./schema/index.js"
import { ImageClient, Service } from "./image-client.js"

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type ImageOptions = Record<string, unknown>

export type ImageRoute<Options extends ImageOptions = ImageOptions> = MediaRoute.Route<
  ImageRequestFor<Options>,
  ImageResponse
>

export class ImageModel<Options extends ImageOptions = ImageOptions> extends MediaModel<ImageRoute<Options>, Options> {
  declare protected readonly _ImageModel: void

  static make<Options extends ImageOptions = ImageOptions>(input: MediaModel.Input<ImageRoute<Options>>) {
    return new ImageModel<Options>(input)
  }

  /** Compose an inline image protocol with its canonical path into a model for one deployment. */
  static fromRoute<Options extends ImageOptions = ImageOptions>(
    route: ImageModel.RouteInput<Options>,
    input: MediaRoute.ModelInput,
  ) {
    return new ImageModel<Options>({
      id: input.id,
      provider: route.provider,
      http: input.http,
      route: composeRoute(MediaRoute.inline, route, input),
    })
  }
}

export namespace ImageModel {
  export type RouteInput<Options extends ImageOptions = ImageOptions> = MediaModel.RouteInput<
    ImageRequestFor<Options>,
    MediaProtocol.Inline<ImageRequestFor<Options>, ImageResponse>
  >
}

export const ImageModelSchema = Schema.declare((value): value is ImageModel => value instanceof ImageModel, {
  expected: "Image.Model",
})

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export type ImageSize = `${number}x${number}`
export const ImageSize = Schema.declare<ImageSize>(
  (value): value is ImageSize => typeof value === "string" && /^\d+x\d+$/.test(value),
  { title: "ImageSize" },
)

export type ImageAspectRatio = Media.AspectRatio
export const ImageAspectRatio = Media.AspectRatio

export type ImageFormat = "png" | "jpeg" | "webp" | (string & {})

export class ImageRequest extends Schema.Class<ImageRequest>("Image.Request")({
  model: ImageModelSchema,
  prompt: Schema.String,
  /** Edit sources or style/subject references, in order. */
  images: Schema.optional(Schema.Array(Media.AssetSchema)),
  /** Inpainting mask; routes that cannot honor it fail with `UnsupportedOperation`. */
  mask: Schema.optional(Media.AssetSchema),
  n: Schema.optional(Schema.Int),
  size: Schema.optional(ImageSize),
  aspectRatio: Schema.optional(ImageAspectRatio),
  seed: Schema.optional(Schema.Number),
  format: Schema.optional(Schema.String),
  providerOptions: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  http: Schema.optional(HttpOptions),
}) {
  declare protected readonly _ImageRequest: void
}

export type ImageRequestFor<Options extends ImageOptions = ImageOptions> = Omit<
  ImageRequest,
  "model" | "providerOptions"
> & {
  readonly model: ImageModel<Options>
  readonly providerOptions?: Options
}

export type ImageModelOptions<Model> = Model extends ImageModel<infer Options> ? Options : never

export type ImageRequestInput<Model extends ImageModel = ImageModel> = Omit<
  ConstructorParameters<typeof ImageRequest>[0],
  "model" | "providerOptions" | "http"
> & {
  readonly model: Model
  readonly format?: ImageFormat
  readonly providerOptions?: NoInfer<ImageModelOptions<Model>>
  readonly http?: HttpOptions.Input
}

// ---------------------------------------------------------------------------
// Response and events
// ---------------------------------------------------------------------------

export class ImageResponse extends Schema.Class<ImageResponse>("Image.Response")({
  images: Schema.Array(Media.AssetSchema),
  usage: Schema.optional(MediaUsage),
  notices: Schema.optional(Schema.Array(Media.Notice)),
  providerMetadata: Schema.optional(ProviderMetadata),
}) {
  get image() {
    return this.images[0]
  }
}

export const ImageOutputEvent = Schema.Struct({
  type: Schema.tag("image"),
  index: Schema.Number,
  image: Media.AssetSchema,
}).annotate({ identifier: "Image.Event.Image" })

export const ImageFinishEvent = Schema.Struct({
  type: Schema.tag("finish"),
  usage: Schema.optional(MediaUsage),
  notices: Schema.optional(Schema.Array(Media.Notice)),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "Image.Event.Finish" })

const imageEventTagged = Schema.Union([ImageOutputEvent, ImageFinishEvent]).pipe(Schema.toTaggedUnion("type"))
export const ImageEvent = Object.assign(imageEventTagged, {
  is: {
    image: imageEventTagged.guards.image,
    finish: imageEventTagged.guards.finish,
  },
})
export type ImageEvent = Schema.Schema.Type<typeof imageEventTagged>

/** Inline routes produce every image at once; expand the response into the streaming event shape. */
export const responseEvents = (response: ImageResponse): ReadonlyArray<ImageEvent> => [
  ...response.images.map((image, index) => ImageOutputEvent.make({ index, image })),
  ImageFinishEvent.make({
    usage: response.usage,
    notices: response.notices,
    providerMetadata: response.providerMetadata,
  }),
]

// ---------------------------------------------------------------------------
// Request-shaped call API
// ---------------------------------------------------------------------------

export function request<const Model extends ImageModel>(
  input: ImageRequestInput<Model>,
): ImageRequestFor<ImageModelOptions<Model>>
export function request(input: ImageRequest): ImageRequest
export function request(input: ImageRequest | ImageRequestInput) {
  if (input instanceof ImageRequest) return input
  return new ImageRequest({
    ...input,
    http: input.http === undefined ? undefined : HttpOptions.make(input.http),
  })
}

const requestEffect = (input: ImageRequest | ImageRequestInput) => tryRequest(() => request(input))

export function generate<const Model extends ImageModel>(
  input: ImageRequestInput<Model>,
): Effect.Effect<ImageResponse, AIError, Service>
export function generate(input: ImageRequest): Effect.Effect<ImageResponse, AIError, Service>
export function generate(input: ImageRequest | ImageRequestInput) {
  return requestEffect(input).pipe(Effect.flatMap((request) => ImageClient.generate(request)))
}

export function stream<const Model extends ImageModel>(
  input: ImageRequestInput<Model>,
): Stream.Stream<ImageEvent, AIError, Service>
export function stream(input: ImageRequest): Stream.Stream<ImageEvent, AIError, Service>
export function stream(input: ImageRequest | ImageRequestInput) {
  return Stream.unwrap(requestEffect(input).pipe(Effect.map((request) => ImageClient.stream(request))))
}

export const Image = {
  request,
  generate,
  stream,
} as const
