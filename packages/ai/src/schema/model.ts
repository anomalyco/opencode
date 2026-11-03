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
import type { Auth } from "../route/auth.js"
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
  // The API is erased over `Options`; constructors trust that it accepts every request this model's `Options` admit.
  declare protected readonly _ProviderOptions: Options
  readonly id: ModelID
  readonly provider: ProviderID
  readonly type: Type
  /** How requests are built and sent. Text APIs may carry a default `baseURL` and `auth`, which the fields below override. */
  readonly api: Model.Api<Type, C>
  /** Text models only: where requests go. */
  readonly baseURL?: string
  /** Text models only: the request path when the host departs from the API's usual one, as models.dev v2 `path`. */
  readonly path?: string
  /** Text models only: how requests authenticate. */
  readonly auth?: Auth.Definition
  readonly options?: RequestOptions
  /** Empty when nothing is known: every field then keeps the protocol default. */
  readonly capabilities: Capabilities
  readonly limit?: Limit
  readonly modalities?: Modalities
  readonly compatibility?: Compatibility
  /** @internal The API deployed at `baseURL` with `auth`; what the clients run. */
  readonly route: Model.Api<Type, C>

  private constructor(input: Model.Fields<Type, C>, route: Model.Api<Type, C>) {
    this.id = input.id
    this.provider = input.provider
    this.type = input.type
    this.api = input.api
    this.baseURL = input.baseURL
    this.path = input.path
    this.auth = input.auth
    this.options = input.options
    this.capabilities = input.capabilities ?? {}
    this.limit = input.limit
    this.modalities = input.modalities
    this.compatibility = input.compatibility
    this.route = route
  }

  static make<Type extends ModelType, Options extends ProviderOptions = ProviderOptions, C extends Compact = Compact>(
    input: Model.Input<Type, C>,
  ): Model<Type, Options, C> {
    const fields = {
      id: ModelID.make(input.id),
      provider: ProviderID.make(input.provider),
      type: input.type,
      api: input.api,
      options: input.options,
      capabilities: input.capabilities,
      limit: input.limit,
      modalities: input.modalities,
      compatibility: input.compatibility,
    }
    if (input.type !== "chat") return new Model<Type, Options, C>(fields, input.api)
    const api = input.api as AnyRoute<C>
    const baseURL = input.baseURL ?? api.endpoint.baseURL
    const auth = input.auth ?? api.auth
    const path = input.path
    const route =
      baseURL === api.endpoint.baseURL && auth === api.auth && path === undefined
        ? api
        : api.with({ endpoint: { baseURL, ...(path === undefined ? {} : { path }) }, auth })
    return new Model<Type, Options, C>(
      // The API's options are a preset under the model's own.
      { ...fields, baseURL, path, auth, options: mergeRequestOptions(api.options, input.options) },
      route as Model.Api<Type, C>,
    )
  }

  /** A copy with `patch` applied; fields `patch` leaves out are kept. A new `api` brings its own `baseURL`, `path` and `auth`. */
  static with<Options extends ProviderOptions, Next extends Compact>(
    model: Model<"chat", Options>,
    patch: Partial<Model.Input<"chat", Next>> & { readonly api: AnyRoute<Next> },
  ): Model<"chat", Options, Next>
  static with<Type extends ModelType, Options extends ProviderOptions, C extends Compact>(
    model: Model<Type, Options, C>,
    patch: Partial<Omit<Model.Input<Type, C>, "api">> & { readonly api?: undefined },
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
    const base = patch.api === undefined ? model : { ...model, baseURL: undefined, path: undefined, auth: undefined }
    return Model.make<Type, Options>({ ...base, ...patch, api: patch.api ?? model.api })
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
  interface Apis<C extends Compact> {
    readonly chat: AnyRoute<C>
    readonly image: ImageRoute
    readonly speech: SpeechRoute
    readonly transcription: TranscriptionRoute
    readonly video: VideoRoute
    readonly extraction: ExtractionRoute
    readonly decision: DecisionModelRoute
  }

  export type Api<Type extends ModelType, C extends Compact = Compact> = Apis<C>[Type]

  export interface Fields<Type extends ModelType, C extends Compact = Compact> {
    readonly id: ModelID
    readonly provider: ProviderID
    readonly type: Type
    readonly api: Api<Type, C>
    readonly baseURL?: string
    readonly path?: string
    readonly auth?: Auth.Definition
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
