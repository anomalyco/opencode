import { Schema } from "effect"
import { ModelID, ProviderID } from "./ids.js"
import type { AnyRoute } from "../route/client.js"
import { isRecord } from "../utils/record.js"

export const JsonSchema = Schema.Record(Schema.String, Schema.Unknown)
export type JsonSchema = Schema.Schema.Type<typeof JsonSchema>

export const mergeJsonRecords = (
  ...items: ReadonlyArray<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined => {
  const defined = items.filter((item): item is Record<string, unknown> => item !== undefined)
  if (defined.length === 0) return undefined
  if (defined.length === 1 && Object.values(defined[0]).every((value) => value !== undefined)) return defined[0]
  const result: Record<string, unknown> = {}
  for (const item of defined) {
    for (const [key, value] of Object.entries(item)) {
      if (value === undefined) continue
      result[key] = isRecord(result[key]) && isRecord(value) ? mergeJsonRecords(result[key], value) : value
    }
  }
  return Object.keys(result).length === 0 ? undefined : result
}

const mergeStringRecords = (
  ...items: ReadonlyArray<Record<string, string> | undefined>
): Record<string, string> | undefined => {
  const defined = items.filter((item): item is Record<string, string> => item !== undefined)
  if (defined.length === 0) return undefined
  if (defined.length === 1) return defined[0]
  const result = Object.fromEntries(
    defined.flatMap((item) =>
      Object.entries(item).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
  )
  return Object.keys(result).length === 0 ? undefined : result
}

export const ProviderOptions = Schema.Record(Schema.String, Schema.Unknown)
export type ProviderOptions = Schema.Schema.Type<typeof ProviderOptions>

export const mergeProviderOptions = (
  ...items: ReadonlyArray<ProviderOptions | undefined>
): ProviderOptions | undefined => mergeJsonRecords(...items)

export class HttpOptions extends Schema.Class<HttpOptions>("AI.HttpOptions")({
  body: Schema.optional(JsonSchema),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  query: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export namespace HttpOptions {
  export type Input = HttpOptions | ConstructorParameters<typeof HttpOptions>[0]

  /** Normalize HTTP option input into the canonical `HttpOptions` class. */
  export const make = (input: Input) => (input instanceof HttpOptions ? input : new HttpOptions(input))
}

export const mergeHttpOptions = (...items: ReadonlyArray<HttpOptions | undefined>): HttpOptions | undefined => {
  const body = mergeJsonRecords(...items.map((item) => item?.body))
  const headers = mergeStringRecords(...items.map((item) => item?.headers))
  const query = mergeStringRecords(...items.map((item) => item?.query))
  if (!body && !headers && !query) return undefined
  return new HttpOptions({ body, headers, query })
}

export class GenerationOptions extends Schema.Class<GenerationOptions>("LLM.GenerationOptions")({
  maxTokens: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  topP: Schema.optional(Schema.Number),
  topK: Schema.optional(Schema.Number),
  frequencyPenalty: Schema.optional(Schema.Number),
  presencePenalty: Schema.optional(Schema.Number),
  seed: Schema.optional(Schema.Number),
  stop: Schema.optional(Schema.Array(Schema.String)),
}) {}

export namespace GenerationOptions {
  export type Input = GenerationOptions | ConstructorParameters<typeof GenerationOptions>[0]

  /** Normalize generation option input into the canonical `GenerationOptions` class. */
  export const make = (input: Input = {}) => (input instanceof GenerationOptions ? input : new GenerationOptions(input))
}

export type GenerationOptionsFields = {
  readonly maxTokens?: number
  readonly temperature?: number
  readonly topP?: number
  readonly topK?: number
  readonly frequencyPenalty?: number
  readonly presencePenalty?: number
  readonly seed?: number
  readonly stop?: ReadonlyArray<string>
}

export type GenerationOptionsInput = GenerationOptions | GenerationOptionsFields

const latestGeneration = <Key extends keyof GenerationOptionsFields>(
  items: ReadonlyArray<GenerationOptionsInput | undefined>,
  key: Key,
) => items.findLast((item) => item?.[key] !== undefined)?.[key]

export const mergeGenerationOptions = (...items: ReadonlyArray<GenerationOptionsInput | undefined>) => {
  const result = new GenerationOptions({
    maxTokens: latestGeneration(items, "maxTokens"),
    temperature: latestGeneration(items, "temperature"),
    topP: latestGeneration(items, "topP"),
    topK: latestGeneration(items, "topK"),
    frequencyPenalty: latestGeneration(items, "frequencyPenalty"),
    presencePenalty: latestGeneration(items, "presencePenalty"),
    seed: latestGeneration(items, "seed"),
    stop: latestGeneration(items, "stop"),
  })
  return Object.values(result).some((value) => value !== undefined) ? result : undefined
}

export class LanguageModelDefaults extends Schema.Class<LanguageModelDefaults>("LLM.LanguageModelDefaults")({
  generation: Schema.optional(GenerationOptions),
  providerOptions: Schema.optional(ProviderOptions),
  http: Schema.optional(HttpOptions),
}) {}

export namespace LanguageModelDefaults {
  export type Input =
    | LanguageModelDefaults
    | {
        readonly generation?: GenerationOptions.Input
        readonly providerOptions?: ProviderOptions
        readonly http?: HttpOptions.Input
      }

  /** Normalize selected-model request defaults without applying precedence. */
  export const make = (input: Input) => {
    if (input instanceof LanguageModelDefaults) return input
    return new LanguageModelDefaults({
      generation: input.generation === undefined ? undefined : GenerationOptions.make(input.generation),
      providerOptions: input.providerOptions,
      http: input.http === undefined ? undefined : HttpOptions.make(input.http),
    })
  }
}

export const LanguageModelToolSchemaCompatibility = Schema.Literals(["gemini", "moonshot"])
export type LanguageModelToolSchemaCompatibility = Schema.Schema.Type<typeof LanguageModelToolSchemaCompatibility>

export const LanguageModelMaxTokensFieldCompatibility = Schema.Literals(["max_completion_tokens", "max_tokens"])
export type LanguageModelMaxTokensFieldCompatibility = Schema.Schema.Type<
  typeof LanguageModelMaxTokensFieldCompatibility
>

export class LanguageModelCompatibility extends Schema.Class<LanguageModelCompatibility>(
  "LLM.LanguageModelCompatibility",
)({
  toolSchema: Schema.optional(LanguageModelToolSchemaCompatibility),
  reasoningField: Schema.optional(Schema.String),
  maxTokensField: Schema.optional(LanguageModelMaxTokensFieldCompatibility),
  requireFinishReason: Schema.optional(Schema.Boolean),
  supportsStore: Schema.optional(Schema.Boolean),
  supportsUsageInStreaming: Schema.optional(Schema.Boolean),
  supportsStrictMode: Schema.optional(Schema.Boolean),
  zaiToolStream: Schema.optional(Schema.Boolean),
}) {}

export namespace LanguageModelCompatibility {
  export type Input = LanguageModelCompatibility | ConstructorParameters<typeof LanguageModelCompatibility>[0]

  /** Normalize model/upstream compatibility metadata without projecting requests. */
  export const make = (input: Input) =>
    input instanceof LanguageModelCompatibility ? input : new LanguageModelCompatibility(input)
}

export class LanguageModel<Options extends ProviderOptions = ProviderOptions> {
  declare protected readonly _ProviderOptions: Options
  readonly id: ModelID
  readonly provider: ProviderID
  readonly route: AnyRoute
  readonly defaults?: LanguageModelDefaults
  readonly compatibility?: LanguageModelCompatibility

  constructor(input: LanguageModel.ConstructorInput) {
    this.id = input.id
    this.provider = input.provider
    this.route = input.route
    this.defaults = input.defaults
    this.compatibility = input.compatibility
  }

  static make<Options extends ProviderOptions = ProviderOptions>(input: LanguageModel.Input) {
    return new LanguageModel<Options>({
      id: ModelID.make(input.id),
      provider: ProviderID.make(input.provider),
      route: input.route,
      defaults: input.defaults === undefined ? undefined : LanguageModelDefaults.make(input.defaults),
      compatibility:
        input.compatibility === undefined ? undefined : LanguageModelCompatibility.make(input.compatibility),
    })
  }

  static input<Options extends ProviderOptions>(model: LanguageModel<Options>): LanguageModel.ConstructorInput {
    return {
      id: model.id,
      provider: model.provider,
      route: model.route,
      defaults: model.defaults,
      compatibility: model.compatibility,
    }
  }

  static update<Options extends ProviderOptions>(model: LanguageModel<Options>, patch: Partial<LanguageModel.Input>) {
    if (Object.keys(patch).length === 0) return model
    return LanguageModel.make<Options>({
      ...LanguageModel.input(model),
      ...patch,
    })
  }
}

export namespace LanguageModel {
  export type ConstructorInput = {
    readonly id: ModelID
    readonly provider: ProviderID
    readonly route: AnyRoute
    readonly defaults?: LanguageModelDefaults
    readonly compatibility?: LanguageModelCompatibility
  }

  export type Input = Omit<ConstructorInput, "id" | "provider" | "defaults" | "compatibility"> & {
    readonly id: string | ModelID
    readonly provider: string | ProviderID
    readonly defaults?: LanguageModelDefaults.Input
    readonly compatibility?: LanguageModelCompatibility.Input
  }
}

export type LanguageModelInput = LanguageModel.Input

export type LanguageModelProviderOptions<SelectedModel> =
  SelectedModel extends LanguageModel<infer Options> ? Options : never

export const LanguageModelSchema = Schema.declare((value): value is LanguageModel => value instanceof LanguageModel, {
  expected: "LLM.LanguageModel",
})

export class CacheHint extends Schema.Class<CacheHint>("LLM.CacheHint")({
  type: Schema.Literals(["ephemeral", "persistent"]),
  ttlSeconds: Schema.optional(Schema.Number),
}) {}

// Auto-placement policy for prompt caching. The protocol-neutral lowering step
// reads this and injects `CacheHint`s at the configured boundaries; the
// per-protocol body builders then translate those hints into wire markers as
// usual. `"auto"` is the default for agent loops — it places
// breakpoints at the last tool definition, the first and last distinct system
// parts, and the conversation tail so recent prefixes remain reusable during
// tool loops.
//
// Pass `"none"` to opt out entirely (the legacy behavior). Pass the granular
// object form to override individual choices.
export const CachePolicyObject = Schema.Struct({
  tools: Schema.optional(Schema.Boolean),
  system: Schema.optional(Schema.Boolean),
  messages: Schema.optional(
    Schema.Union([
      Schema.Literal("latest-user-message"),
      Schema.Literal("latest-assistant"),
      Schema.Struct({ tail: Schema.Number }),
    ]),
  ),
  ttlSeconds: Schema.optional(Schema.Number),
})
export type CachePolicyObject = Schema.Schema.Type<typeof CachePolicyObject>

export const CachePolicy = Schema.Union([Schema.Literal("auto"), Schema.Literal("none"), CachePolicyObject])
export type CachePolicy = Schema.Schema.Type<typeof CachePolicy>
