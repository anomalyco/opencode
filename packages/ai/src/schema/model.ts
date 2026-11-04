import { Schema } from "effect"
import type { Api } from "./api.js"
import type { Cost } from "./cost.js"
import {
  mergeRequestOptions,
  type Capabilities,
  type Compatibility,
  type OpenString,
  type RequestOptions,
  type ProviderOptions,
} from "./options.js"
import type { Auth } from "../route/auth.js"
import { isRecord } from "../utils/record.js"
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

/** Where a model built by a provider keeps its implementation of `api`, outside the public shape. Spreads keep it. */
export const implementation: unique symbol = Symbol("@opencode/ai/implementation")

/**
 * One model of any type, as a plain readonly object: who serves it, which API it speaks, what it accepts, and the
 * options every request starts from. `type` selects the `ai.*` entry point that takes it and narrows the union.
 * Edit a model with a spread, such as `{ ...model, baseURL }`.
 */
export type Model<
  Type extends ModelType = ModelType,
  Options extends ProviderOptions = ProviderOptions,
  C extends Compact = Compact,
> = Type extends "chat" ? Model.Chat<Options, C> : Type extends ModelType ? Model.Fields<Type, Options, C> : never

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

  /** The implementation behind a model of the given type. */
  export type Route<Type extends ModelType, C extends Compact = Compact> = Routes<C>[Type]

  export interface Fields<Type extends ModelType, Options extends ProviderOptions, C extends Compact> {
    readonly id: string
    readonly provider: string
    readonly type: Type
    /** The models.dev v2 API the model speaks, such as `"chat-completions"`, `"messages"` or `"images"`. */
    readonly api: Api
    /** Options every request starts from; the request's own win per key. */
    readonly options?: Omit<RequestOptions, "providerOptions"> & { readonly providerOptions?: Options }
    /** What the model accepts. Flags left unset keep the protocol's own detection. */
    readonly capabilities: Capabilities
    readonly limit: Limit
    readonly modalities: Modalities
    readonly compatibility?: Compatibility
    /** Listed prices, as models.dev v2 `cost`. `calculateCost(model.cost, usage)` turns usage into USD. */
    readonly cost?: Cost
    /** The provider's implementation of `api`, such as a vendor dialect. Absent means the package's standard one. */
    readonly [implementation]?: Route<Type, C>
  }

  export interface Chat<Options extends ProviderOptions = ProviderOptions, C extends Compact = Compact>
    extends Fields<"chat", Options, C> {
    /** Where requests go; the API's default host when unset. */
    readonly baseURL?: string
    /** The request path when the host departs from the API's usual one, as models.dev v2 `path`. */
    readonly path?: string
    /** How requests authenticate; the API's default when unset. */
    readonly auth?: Auth.Definition
  }

  /** `Model.make` input: a model whose `capabilities`, `limit` and `modalities` may be left out. */
  export interface Input<Type extends ModelType, C extends Compact = Compact> {
    readonly id: string
    readonly provider: string
    readonly type: Type
    readonly api: Api
    /** Text models only. */
    readonly baseURL?: Type extends "chat" ? string : never
    /** Text models only. */
    readonly path?: Type extends "chat" ? string : never
    /** Text models only. */
    readonly auth?: Type extends "chat" ? Auth.Definition : never
    readonly options?: RequestOptions
    readonly capabilities?: Capabilities
    readonly limit?: Limit
    readonly modalities?: Modalities
    readonly compatibility?: Compatibility
    readonly cost?: Cost
    readonly [implementation]?: Route<Type, C>
  }

  /**
   * A model from its description, with OpenCode's defaults for an unknown model: tools supported, text and image in,
   * text out, a 200k context and 32k output. A text model built on a provider's implementation also takes that
   * implementation's `baseURL`, `auth` and options where it leaves them out.
   */
  export const make = <
    Type extends ModelType,
    Options extends ProviderOptions = ProviderOptions,
    C extends Compact = Compact,
  >(
    input: Input<Type, C>,
  ): Model<Type, Options, C> => {
    const route = input.type === "chat" ? (input[implementation] as AnyRoute<C> | undefined) : undefined
    // The model's `providerOptions` type is a promise the API's request typing keeps; nothing here can check it.
    return {
      ...input,
      capabilities: { ...input.capabilities, tools: { supported: true, ...input.capabilities?.tools } },
      limit: input.limit ?? { context: 200_000, output: 32_000 },
      modalities: input.modalities ?? { input: ["text", "image"], output: ["text"] },
      ...(route && {
        baseURL: input.baseURL ?? route.endpoint.baseURL,
        auth: input.auth ?? route.auth,
        options: mergeRequestOptions(route.options, input.options),
      }),
    } as Model<Type, Options, C>
  }
}

/**
 * The implementation a provider attached to the model. A text model's counts only while it still implements the
 * model's `api`, so a spread that changes `api` falls back to the package's standard implementation.
 */
export const attachedRoute = <Type extends ModelType, C extends Compact = Compact>(
  model: Model.Fields<Type, ProviderOptions, C>,
): Model.Route<Type, C> | undefined => {
  const route = model[implementation]
  if (route === undefined || model.type !== "chat") return route
  const chat = route as AnyRoute
  return (chat.api ?? chat.protocol) === model.api ? route : undefined
}

/** The implementation a model's requests run on, once the client attached it. */
export const routeOf = <Type extends ModelType, C extends Compact = Compact>(
  model: Model.Fields<Type, ProviderOptions, C>,
): Model.Route<Type, C> => {
  const route = attachedRoute(model)
  if (route === undefined) throw new Error(`${model.provider}/${model.id} has no implementation of "${model.api}"`)
  return route
}

/** A Schema that accepts models of the given type, for request schemas. */
export const modelSchema = <Type extends ModelType>(type: Type) =>
  Schema.declare(
    (value): value is Model<Type> => isRecord(value) && value.type === type && typeof value.api === "string",
    { expected: `Model<"${type}">` },
  )

/** The `providerOptions` type a model's requests accept. */
export type ModelProviderOptions<SelectedModel> =
  SelectedModel extends Model<ModelType, infer Options> ? Options : never
