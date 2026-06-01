import { Schema } from "effect"
import { JsonSchema, ModelID, ProviderID } from "./ids"
import type { AnyRoute } from "../route/client"
import { isRecord } from "../utils/record"

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

export const ProviderOptions = Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))
export type ProviderOptions = Schema.Schema.Type<typeof ProviderOptions>

export const mergeProviderOptions = (
  ...items: ReadonlyArray<ProviderOptions | undefined>
): ProviderOptions | undefined => {
  const result: Record<string, Record<string, unknown>> = {}
  for (const item of items) {
    if (!item) continue
    for (const [provider, options] of Object.entries(item)) {
      const merged = mergeJsonRecords(result[provider], options)
      if (merged) result[provider] = merged
    }
  }
  return Object.keys(result).length === 0 ? undefined : result
}

export class HttpOptions extends Schema.Class<HttpOptions>("LLM.HttpOptions")({
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

export class ModelLimits extends Schema.Class<ModelLimits>("LLM.ModelLimits")({
  context: Schema.optional(Schema.Number),
  output: Schema.optional(Schema.Number),
}) {}

export namespace ModelLimits {
  export type Input = ModelLimits | ConstructorParameters<typeof ModelLimits>[0]

  /** Normalize model limit input into the canonical `ModelLimits` class. */
  export const make = (input: Input | undefined) =>
    input instanceof ModelLimits ? input : new ModelLimits(input ?? {})
}

export class Model {
  readonly id: ModelID
  readonly provider: ProviderID
  readonly route: AnyRoute

  constructor(input: Model.ConstructorInput) {
    this.id = input.id
    this.provider = input.provider
    this.route = input.route
  }

  static make(input: Model.Input) {
    return new Model({
      id: ModelID.make(input.id),
      provider: ProviderID.make(input.provider),
      route: input.route,
    })
  }

  static input(model: Model): Model.ConstructorInput {
    return {
      id: model.id,
      provider: model.provider,
      route: model.route,
    }
  }

  static update(model: Model, patch: Partial<Model.Input>) {
    if (Object.keys(patch).length === 0) return model
    return Model.make({
      ...Model.input(model),
      ...patch,
    })
  }
}

export namespace Model {
  export type ConstructorInput = {
    readonly id: ModelID
    readonly provider: ProviderID
    readonly route: AnyRoute
  }

  export type Input = Omit<ConstructorInput, "id" | "provider"> & {
    readonly id: string | ModelID
    readonly provider: string | ProviderID
  }
}

export type ModelInput = Model.Input

export const ModelSchema = Schema.declare((value): value is Model => value instanceof Model, { expected: "LLM.Model" })

export class CacheHint extends Schema.Class<CacheHint>("LLM.CacheHint")({
  type: Schema.Literals(["ephemeral", "persistent"]),
  ttlSeconds: Schema.optional(Schema.Number),
}) {}

// Auto-placement policy for prompt caching. The protocol-neutral lowering step
// reads this and injects `CacheHint`s at the configured boundaries; the
// per-protocol body builders then translate those hints into wire markers as
// usual. `"auto"` is the recommended default for agent loops — it places one
// breakpoint at the last tool definition, one at the last system part, and one
// at the latest user message. The combination of provider invalidation
// hierarchy (tools → system → messages) and Anthropic/Bedrock's 20-block
// lookback means three trailing breakpoints reliably cover the static prefix.
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
