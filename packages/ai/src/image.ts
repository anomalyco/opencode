import { Effect, Schema, Stream } from "effect"
import { Media } from "./media.js"
import { ModelRef, type ResolveImageModel } from "./model-ref.js"
import { Endpoint } from "./route/endpoint.js"
import { MediaRoute } from "./route/media.js"
import type { MediaProtocol } from "./route/media-protocol.js"
import {
  AIError,
  HttpOptions,
  InvalidRequestError,
  MediaUsage,
  ModelID,
  ProviderID,
  ProviderMetadata,
  UnsupportedOperationError,
} from "./schema/index.js"
import { ImageClient, Service } from "./image-client.js"

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type ImageOptions = Record<string, unknown>

export type ImageRoute<Options extends ImageOptions = ImageOptions> = MediaRoute.Route<
  ImageRequestFor<Options>,
  ImageResponse
>

export class ImageModel<Options extends ImageOptions = ImageOptions> {
  declare protected readonly _Options: (options: Options) => Options
  readonly id: ModelID
  readonly provider: ProviderID
  readonly route: ImageRoute<Options>
  readonly http?: HttpOptions

  constructor(input: ImageModel.Input<Options>) {
    this.id = input.id
    this.provider = input.provider
    this.route = input.route
    this.http = input.http
  }

  static make<Options extends ImageOptions = ImageOptions>(input: ImageModel.MakeInput<Options>) {
    return new ImageModel<Options>({
      id: ModelID.make(input.id),
      provider: ProviderID.make(input.provider),
      route: input.route,
      http: input.http,
    })
  }

  /** Compose an inline image protocol with its canonical path into a model for one deployment. */
  static fromRoute<Options extends ImageOptions = ImageOptions>(
    route: ImageModel.RouteInput<Options>,
    input: MediaRoute.ModelInput,
  ) {
    return ImageModel.make<Options>({
      id: input.id,
      provider: route.provider,
      http: input.http,
      route: MediaRoute.make({
        id: route.id,
        provider: route.provider,
        protocol: route.protocol,
        endpoint: Endpoint.path(route.path, { baseURL: input.baseURL ?? route.baseURL }),
        auth: input.auth,
        headers: input.headers,
      }),
    })
  }
}

export namespace ImageModel {
  export interface Input<Options extends ImageOptions = ImageOptions> {
    readonly id: ModelID
    readonly provider: ProviderID
    readonly route: ImageRoute<Options>
    readonly http?: HttpOptions
  }

  export interface MakeInput<Options extends ImageOptions = ImageOptions>
    extends Omit<Input<Options>, "id" | "provider"> {
    readonly id: string | ModelID
    readonly provider: string | ProviderID
  }

  export interface RouteInput<Options extends ImageOptions = ImageOptions> {
    readonly id: string
    readonly provider: string | ProviderID
    readonly protocol: MediaProtocol.Inline<ImageRequestFor<Options>, ImageResponse>
    readonly path: Endpoint.EndpointPart<MediaProtocol.Body, ImageRequestFor<Options>>
    /** Canonical base URL; `ModelInput.baseURL` overrides it per deployment. */
    readonly baseURL?: string
  }
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

export type ImageAspectRatio = `${number}:${number}`
export const ImageAspectRatio = Schema.declare<ImageAspectRatio>(
  (value): value is ImageAspectRatio => typeof value === "string" && /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(value),
  { title: "ImageAspectRatio" },
)

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

export type ImageModelInput = ImageModel | ModelRef.WithImage

export type ImageModelOptions<Model> = ResolveImageModel<Model> extends ImageModel<infer Options> ? Options : never

export type ImageRequestInput<Model extends ImageModelInput = ImageModelInput> = Omit<
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

const resolveModel = (model: ImageModelInput): ImageModel => {
  if (model instanceof ImageModel) return model
  // Typed callers cannot reach the throw; it guards JS callers passing a ref without an image selector.
  const selected = model.facade.image?.(model.id)
  if (selected) return selected
  throw new AIError({
    reason: new UnsupportedOperationError({
      operation: "image",
      provider: model.provider,
      message: `${model.provider} does not expose an image route for ${model.id}`,
    }),
  })
}

export function request<const Model extends ImageModelInput>(
  input: ImageRequestInput<Model>,
): ImageRequestFor<ImageModelOptions<Model>>
export function request(input: ImageRequest): ImageRequest
export function request(input: ImageRequest | ImageRequestInput) {
  if (input instanceof ImageRequest) return input
  return new ImageRequest({
    ...input,
    model: resolveModel(input.model),
    http: input.http === undefined ? undefined : HttpOptions.make(input.http),
  })
}

const requestEffect = (input: ImageRequest | ImageRequestInput) =>
  Effect.try({
    try: () => request(input),
    catch: (error) =>
      error instanceof AIError
        ? error
        : new AIError({
            reason: new InvalidRequestError({
              message: error instanceof Error ? error.message : String(error),
              cause: error,
            }),
          }),
  })

export function generate<const Model extends ImageModelInput>(
  input: ImageRequestInput<Model>,
): Effect.Effect<ImageResponse, AIError, Service>
export function generate(input: ImageRequest): Effect.Effect<ImageResponse, AIError, Service>
export function generate(input: ImageRequest | ImageRequestInput) {
  return requestEffect(input).pipe(Effect.flatMap((request) => ImageClient.generate(request)))
}

export function stream<const Model extends ImageModelInput>(
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
