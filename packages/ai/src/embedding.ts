import { Effect, Schema } from "effect"
import { EmbeddingClient, Service, type Execute } from "./embedding-client.js"
import { Media } from "./media.js"
import { tryRequest } from "./media-model.js"
import {
  type AIError,
  type BaseRequest,
  type HttpOptions,
  ModelID,
  ProviderID,
  ProviderMetadata,
  ProviderOptions,
} from "./schema/index.js"

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** One value to embed: text, or a media asset for hosts that embed images, audio or documents. */
export const EmbeddingValue = Schema.Union([Schema.String, Media.AssetSchema])
export type EmbeddingValue = Schema.Schema.Type<typeof EmbeddingValue>

/** A string is always text; media is an `Asset` or plain bytes or a URL, normalized with `Media.make`. */
export type EmbeddingValueInput = string | Exclude<Media.Input, string>

/**
 * What the vectors are for: a search `query`, or a `document` stored to be searched. Hosts without such a field embed
 * both the same way and ignore it.
 */
export type EmbeddingInputType = "query" | "document"

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type EmbeddingOptions = Record<string, unknown>

/** What an embedding model's route does; `EmbeddingRoute.make(...).model(...)` builds one from a protocol. */
export interface EmbeddingModelRoute<Options extends EmbeddingOptions = EmbeddingOptions> {
  readonly id: string
  generate(request: EmbeddingRequest<EmbeddingModel<Options>>, execute: Execute): Effect.Effect<EmbeddingResponse, AIError>
}

export class EmbeddingModel<Options extends EmbeddingOptions = EmbeddingOptions> {
  declare protected readonly _Options: Options
  readonly id: ModelID
  readonly provider: ProviderID
  readonly route: EmbeddingModelRoute<Options>
  readonly http?: HttpOptions
  /** Defaults under each request's `providerOptions`, such as options a provider package reads from its settings. */
  readonly providerOptions?: ProviderOptions

  constructor(input: EmbeddingModel.Input<Options>) {
    this.id = input.id
    this.provider = input.provider
    this.route = input.route
    this.http = input.http
    this.providerOptions = input.providerOptions
  }

  static make<Options extends EmbeddingOptions = EmbeddingOptions>(input: EmbeddingModel.MakeInput<Options>) {
    return new EmbeddingModel<Options>({
      ...input,
      id: ModelID.make(input.id),
      provider: ProviderID.make(input.provider),
    })
  }
}

export namespace EmbeddingModel {
  export interface Input<Options extends EmbeddingOptions = EmbeddingOptions> {
    readonly id: ModelID
    readonly provider: ProviderID
    readonly route: EmbeddingModelRoute<Options>
    readonly http?: HttpOptions
    readonly providerOptions?: ProviderOptions
  }

  export interface MakeInput<Options extends EmbeddingOptions = EmbeddingOptions>
    extends Omit<Input<Options>, "id" | "provider"> {
    readonly id: string | ModelID
    readonly provider: string | ProviderID
  }
}

export const EmbeddingModelSchema = Schema.declare(
  (value): value is EmbeddingModel => value instanceof EmbeddingModel,
  { expected: "Embedding.Model" },
)

export type EmbeddingModelOptions<Model> = Model extends EmbeddingModel<infer Options> ? Options : never

// ---------------------------------------------------------------------------
// Request and response
// ---------------------------------------------------------------------------

const EmbeddingRequestSchema = Schema.Struct({
  model: EmbeddingModelSchema,
  values: Schema.Array(EmbeddingValue).pipe(
    Schema.refine((x): x is typeof x => x.length > 0, { message: "Embedding values must not be empty" }),
  ),
  dimensions: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  inputType: Schema.optional(Schema.Literals(["query", "document"])),
  providerOptions: Schema.optional(ProviderOptions),
})

/** A normalized embedding request, the plain object `ai.embedding.request(...)` returns. */
export interface EmbeddingRequest<Model extends EmbeddingModel = EmbeddingModel>
  extends BaseRequest<Model, EmbeddingModelOptions<Model>> {
  readonly values: ReadonlyArray<EmbeddingValue>
  /** Requested vector length, for models that can shorten their output. */
  readonly dimensions?: number
  readonly inputType?: EmbeddingInputType
}

/** Input accepted by `ai.embedding.request` and `generate`. An `EmbeddingRequest` is also a valid input. */
export interface EmbeddingRequestInput<Model extends EmbeddingModel = EmbeddingModel>
  extends BaseRequest<Model, NoInfer<EmbeddingModelOptions<Model>>> {
  readonly values: ReadonlyArray<EmbeddingValueInput>
  readonly dimensions?: number
  readonly inputType?: EmbeddingInputType
}

/** What embedding hosts report; their raw usage stays in the response's `providerMetadata`. */
export class EmbeddingUsage extends Schema.Class<EmbeddingUsage>("Embedding.Usage")({
  inputTokens: Schema.optional(Schema.Number),
}) {}

export class EmbeddingResponse extends Schema.Class<EmbeddingResponse>("Embedding.Response")({
  /** One vector per value, in value order. */
  embeddings: Schema.Array(Schema.Array(Schema.Number)),
  usage: Schema.optional(EmbeddingUsage),
  providerMetadata: Schema.optional(ProviderMetadata),
}) {}

// ---------------------------------------------------------------------------
// Call API
// ---------------------------------------------------------------------------

/** Normalize embedding request input into a plain `EmbeddingRequest`; non-string values become `Media.Asset`s. */
export const request = <const Model extends EmbeddingModel>(
  input: EmbeddingRequestInput<Model>,
): EmbeddingRequest<Model> => ({
  ...input,
  values: input.values.map((value) => (typeof value === "string" ? value : Media.make(value))),
})

const validate = Schema.decodeUnknownSync(EmbeddingRequestSchema)

export function generate<const Model extends EmbeddingModel>(
  input: EmbeddingRequestInput<Model>,
): Effect.Effect<EmbeddingResponse, AIError, Service> {
  return tryRequest(() => {
    const normalized = request(input)
    validate(normalized)
    return normalized
  }).pipe(Effect.flatMap(EmbeddingClient.generate))
}

export const Embedding = {
  request,
  generate,
} as const
