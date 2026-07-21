import { Effect, Schema } from "effect"
import { HttpOptions, InvalidRequestReason, LLMError, ModelID, ProviderID, ProviderMetadata, Usage } from "./schema"
import { ImageClient, Service, type Execute as ImageExecute } from "./image-client"

export interface ImageRoute<Options extends ImageOptions = ImageOptions> {
  readonly id: string
  readonly generate: (
    request: ImageRequestFor<Options>,
    execute: ImageExecute,
  ) => Effect.Effect<ImageResponse, LLMError>
}

export type ImageOptions = Record<string, unknown>

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
}

export const ImageModelSchema = Schema.declare((value): value is ImageModel => value instanceof ImageModel, {
  expected: "Image.Model",
})

const ImageBytesInput = Schema.Struct({
  type: Schema.Literal("bytes"),
  data: Schema.Uint8Array,
  mediaType: Schema.String,
})
const ImageUrlInput = Schema.Struct({
  type: Schema.Literal("url"),
  url: Schema.String,
})
const ImageFileIDInput = Schema.Struct({
  type: Schema.Literal("file-id"),
  id: Schema.String,
})
const ImageFileURIInput = Schema.Struct({
  type: Schema.Literal("file-uri"),
  uri: Schema.String,
  mediaType: Schema.String,
})

export const ImageInputSchema = Schema.Union([
  ImageBytesInput,
  ImageUrlInput,
  ImageFileIDInput,
  ImageFileURIInput,
]).pipe(Schema.toTaggedUnion("type"))
export type ImageInput = Schema.Schema.Type<typeof ImageInputSchema>

export const ImageInput = {
  bytes: (data: Uint8Array, mediaType: string): ImageInput => ({ type: "bytes", data, mediaType }),
  url: (url: string): ImageInput => ({ type: "url", url }),
  file: (id: string): ImageInput => ({ type: "file-id", id }),
  fileUri: (uri: string, mediaType: string): ImageInput => ({ type: "file-uri", uri, mediaType }),
} as const

export class ImageRequest extends Schema.Class<ImageRequest>("Image.Request")({
  model: ImageModelSchema,
  prompt: Schema.String,
  images: Schema.optional(Schema.Array(ImageInputSchema)),
  options: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  http: Schema.optional(HttpOptions),
}) {
  declare protected readonly _ImageRequest: void
}

export type ImageRequestFor<Options extends ImageOptions = ImageOptions> = Omit<ImageRequest, "model" | "options"> & {
  readonly model: ImageModel<Options>
  readonly options?: Options
}

export type ImageModelOptions<Model> = Model extends ImageModel<infer Options> ? Options : never

export type ImageRequestInput<Model extends object = ImageModel> = Omit<
  ConstructorParameters<typeof ImageRequest>[0],
  "model" | "options" | "http"
> & {
  readonly model: Model
  readonly options?: NoInfer<ImageModelOptions<Model>>
  readonly http?: HttpOptions.Input
} & (Model extends ImageModel<ImageModelOptions<Model>> ? unknown : never)

export class GeneratedImage extends Schema.Class<GeneratedImage>("Image.Generated")({
  mediaType: Schema.String,
  data: Schema.Union([Schema.String, Schema.Uint8Array]),
  providerMetadata: Schema.optional(ProviderMetadata),
}) {}

export class ImageResponse extends Schema.Class<ImageResponse>("Image.Response")({
  images: Schema.Array(GeneratedImage),
  usage: Schema.optional(Usage),
  providerMetadata: Schema.optional(ProviderMetadata),
}) {
  get image() {
    return this.images[0]
  }
}

export function request<const Model extends object>(
  input: ImageRequestInput<Model>,
): ImageRequestFor<ImageModelOptions<Model>>
export function request(input: ImageRequest): ImageRequest
export function request(input: ImageRequest | ImageRequestInput) {
  if (input instanceof ImageRequest) return input
  return new ImageRequest({
    ...input,
    model: input.model as unknown as ImageModel,
    http: input.http === undefined ? undefined : HttpOptions.make(input.http),
  })
}

export function generate<const Model extends object>(
  input: ImageRequestInput<Model>,
): Effect.Effect<ImageResponse, LLMError, Service>
export function generate(input: ImageRequest): Effect.Effect<ImageResponse, LLMError, Service>
export function generate(input: ImageRequest | ImageRequestInput) {
  return Effect.try({
    try: () => (input instanceof ImageRequest ? input : request(input)),
    catch: (error) =>
      new LLMError({
        module: "Image",
        method: "generate",
        reason: new InvalidRequestReason({ message: error instanceof Error ? error.message : String(error) }),
      }),
  }).pipe(Effect.flatMap((request) => ImageClient.generate(request as unknown as ImageRequestFor<ImageOptions>)))
}

export const Image = {
  request,
  generate,
} as const
