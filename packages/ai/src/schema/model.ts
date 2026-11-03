import { Schema } from "effect"
import { ModelID, ProviderID } from "./ids.js"
import {
  mergeRequestOptions,
  type Capabilities,
  type Compatibility,
  type OpenString,
  type RequestOptions,
  type ProviderOptions,
} from "./options.js"
import type { AnyRoute, CompactionOperations } from "../route/client.js"
import type { DecisionModelRoute } from "../decision.js"
import type { ImageRoute } from "../image.js"
import type { SpeechRoute } from "../speech.js"
import type { TranscriptionRoute } from "../transcription.js"
import type { VideoRoute } from "../video.js"
import type { ExtractionRoute } from "../experimental/extraction.js"

/** The kind of model, named after models.dev model types. Each `ai.*` entry point takes one. */
export type ModelType = "chat" | "image" | "speech" | "transcription" | "video" | "extraction" | "decision"

/** Size limits, from models.dev v2 `limit` in camelCase. Carried for callers; requests don't read them yet. */
export interface Limit {
  readonly context?: number
  readonly input?: number
  readonly output?: number
  readonly requestBytes?: number
  readonly image?: {
    readonly maxPerMessage?: number
    readonly maxPerRequest?: number
    readonly maxBytes?: number
    readonly minWidth?: number
    readonly minHeight?: number
    readonly maxWidth?: number
    readonly maxHeight?: number
  }
  readonly pdf?: { readonly maxPerRequest?: number; readonly maxBytes?: number; readonly maxPages?: number }
}

/** A models.dev v2 modality: a broad kind or an exact MIME type. Outputs may also be `decision`, `embedding` or `reranking`. */
export type Modality = OpenString<
  "text" | "image" | "audio" | "video" | "application/pdf" | "decision" | "embedding" | "reranking"
>

/** Input and output modalities, from models.dev v2 `modalities`. Carried for callers; requests don't read them yet. */
export interface Modalities {
  readonly input: ReadonlyArray<Modality>
  readonly output: ReadonlyArray<Modality>
}

type Compact = CompactionOperations | undefined

/**
 * One model of any type: who serves it, how it is reached, what it accepts, and the options every request starts
 * from. `type` selects the `ai.*` entry point that takes it.
 */
export class Model<
  Type extends ModelType = ModelType,
  Options extends ProviderOptions = ProviderOptions,
  C extends Compact = Compact,
> {
  // The route is erased over `Options`; constructors trust that it accepts every request this model's `Options` admit.
  declare protected readonly _ProviderOptions: Options
  readonly id: ModelID
  readonly provider: ProviderID
  readonly type: Type
  readonly route: Model.Route<Type, C>
  readonly options?: RequestOptions
  /** Empty when nothing is known: every field then keeps the protocol default. */
  readonly capabilities: Capabilities
  readonly limit?: Limit
  readonly modalities?: Modalities
  readonly compatibility?: Compatibility

  private constructor(input: Model.Fields<Type, C>) {
    this.id = input.id
    this.provider = input.provider
    this.type = input.type
    this.route = input.route
    this.options = input.options
    this.capabilities = input.capabilities ?? {}
    this.limit = input.limit
    this.modalities = input.modalities
    this.compatibility = input.compatibility
  }

  static make<Type extends ModelType, Options extends ProviderOptions = ProviderOptions, C extends Compact = Compact>(
    input: Model.Input<Type, C>,
  ): Model<Type, Options, C> {
    // A text route's options are a preset under the model's own.
    const preset = "options" in input.route ? (input.route.options as RequestOptions | undefined) : undefined
    return new Model<Type, Options, C>({
      ...input,
      id: ModelID.make(input.id),
      provider: ProviderID.make(input.provider),
      options: mergeRequestOptions(preset, input.options),
    })
  }

  /** A copy with `patch` applied; fields `patch` leaves out are kept. */
  static with<Options extends ProviderOptions, Next extends Compact>(
    model: Model<"chat", Options>,
    patch: Partial<Model.Input<"chat", Next>> & { readonly route: AnyRoute<Next> },
  ): Model<"chat", Options, Next>
  static with<Type extends ModelType, Options extends ProviderOptions, C extends Compact>(
    model: Model<Type, Options, C>,
    patch: Partial<Omit<Model.Input<Type, C>, "route">> & { readonly route?: undefined },
  ): Model<Type, Options, C>
  static with<Type extends ModelType, Options extends ProviderOptions>(
    model: Model<Type, Options>,
    patch: Partial<Model.Input<Type>>,
  ): Model<Type, Options>
  static with<Type extends ModelType, Options extends ProviderOptions>(
    model: Model<Type, Options>,
    patch: Partial<Model.Input<Type>>,
  ) {
    if (Object.keys(patch).length === 0) return model
    return Model.make<Type, Options>({ ...model, ...patch, route: patch.route ?? model.route })
  }

  /** Whether `value` is a model of the given type. */
  static is<Type extends ModelType>(type: Type) {
    return (value: unknown): value is Model<Type> => value instanceof Model && value.type === type
  }

  /** A Schema that accepts models of the given type, for request schemas. */
  static schema<Type extends ModelType>(type: Type) {
    return Schema.declare(Model.is(type), { expected: `Model<"${type}">` })
  }
}

export namespace Model {
  interface Routes<C extends Compact> {
    readonly chat: AnyRoute<C>
    readonly image: ImageRoute
    readonly speech: SpeechRoute
    readonly transcription: TranscriptionRoute
    readonly video: VideoRoute
    readonly extraction: ExtractionRoute
    readonly decision: DecisionModelRoute
  }

  export type Route<Type extends ModelType, C extends Compact = Compact> = Routes<C>[Type]

  export interface Fields<Type extends ModelType, C extends Compact = Compact> {
    readonly id: ModelID
    readonly provider: ProviderID
    readonly type: Type
    readonly route: Route<Type, C>
    readonly options?: RequestOptions
    readonly capabilities?: Capabilities
    readonly limit?: Limit
    readonly modalities?: Modalities
    readonly compatibility?: Compatibility
  }

  export interface Input<Type extends ModelType, C extends Compact = Compact>
    extends Omit<Fields<Type, C>, "id" | "provider"> {
    readonly id: string | ModelID
    readonly provider: string | ProviderID
  }
}

/** The `providerOptions` type a model's requests accept. */
export type ModelProviderOptions<SelectedModel> =
  SelectedModel extends Model<ModelType, infer Options> ? Options : never
