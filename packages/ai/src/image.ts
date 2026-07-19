import { Effect, Schema } from "effect"
import { HttpOptions, InvalidRequestReason, LLMError, ModelID, ProviderID, ProviderMetadata, Usage } from "./schema"
import { ImageClient, type Execute as ImageExecute } from "./image-client"

export interface ImageRoute {
  readonly id: string
  readonly generate: (request: ImageRequest, execute: ImageExecute) => Effect.Effect<ImageResponse, LLMError>
}

export class ImageModel {
  readonly id: ModelID
  readonly provider: ProviderID
  readonly route: ImageRoute
  readonly defaults?: ImageModelDefaults

  constructor(input: ImageModel.Input) {
    this.id = input.id
    this.provider = input.provider
    this.route = input.route
    this.defaults = input.defaults
  }

  static make(input: ImageModel.MakeInput) {
    return new ImageModel({
      id: ModelID.make(input.id),
      provider: ProviderID.make(input.provider),
      route: input.route,
      defaults: input.defaults,
    })
  }
}

export namespace ImageModel {
  export interface Input {
    readonly id: ModelID
    readonly provider: ProviderID
    readonly route: ImageRoute
    readonly defaults?: ImageModelDefaults
  }

  export interface MakeInput extends Omit<Input, "id" | "provider"> {
    readonly id: string | ModelID
    readonly provider: string | ProviderID
  }
}

export interface ImageModelDefaults {
  readonly providerOptions?: Record<string, Record<string, unknown>>
  readonly http?: HttpOptions
}

export const ImageModelSchema = Schema.declare((value): value is ImageModel => value instanceof ImageModel, {
  expected: "Image.Model",
})

export const ImageSize = Schema.Struct({
  width: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  height: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
}).annotate({ identifier: "Image.Size" })
export type ImageSize = Schema.Schema.Type<typeof ImageSize>

export class ImageRequest extends Schema.Class<ImageRequest>("Image.Request")({
  model: ImageModelSchema,
  prompt: Schema.String,
  count: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  size: Schema.optional(ImageSize),
  aspectRatio: Schema.optional(Schema.String),
  seed: Schema.optional(Schema.Number),
  providerOptions: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
  http: Schema.optional(HttpOptions),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export type ImageRequestInput = Omit<ConstructorParameters<typeof ImageRequest>[0], "http"> & {
  readonly http?: HttpOptions.Input
}

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

export const request = (input: ImageRequest | ImageRequestInput) => {
  if (input instanceof ImageRequest) return input
  return new ImageRequest({
    ...input,
    http: input.http === undefined ? undefined : HttpOptions.make(input.http),
  })
}

export const generate = (input: ImageRequest | ImageRequestInput) =>
  Effect.try({
    try: () => request(input),
    catch: (error) =>
      new LLMError({
        module: "Image",
        method: "generate",
        reason: new InvalidRequestReason({ message: error instanceof Error ? error.message : String(error) }),
      }),
  }).pipe(Effect.flatMap(ImageClient.generate))

export const Image = {
  request,
  generate,
} as const
