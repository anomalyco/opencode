import { Schema } from "effect"
import { JsonSchema, ModelID, ProviderID, RouteID } from "./ids"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

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

export class ModelRef extends Schema.Class<ModelRef>("LLM.ModelRef")({
  id: ModelID,
  provider: ProviderID,
  route: RouteID,
  baseURL: Schema.String,
  /** Provider-specific API key convenience. Provider helpers normalize this into `auth`. */
  apiKey: Schema.optional(Schema.String),
  /** Optional transport auth policy. Opaque because it may contain functions. */
  auth: Schema.optional(Schema.Any),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  /**
   * Query params appended to the request URL by `Endpoint.baseURL`. Used for
   * deployment-level URL-scoped settings such as Azure's `api-version` or any
   * provider that requires a per-request key in the URL. Generic concern, so
   * lives as a typed first-class field instead of `native`.
   */
  queryParams: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  limits: ModelLimits,
  /** Provider-neutral generation defaults. Request-level values override them. */
  generation: Schema.optional(GenerationOptions),
  /** Provider-owned typed-at-the-facade options for non-portable knobs. */
  providerOptions: Schema.optional(ProviderOptions),
  /** Serializable raw HTTP overlays applied to the final outgoing request. */
  http: Schema.optional(HttpOptions),
  /**
   * Provider-specific opaque options. Reach for this only when the value is
   * genuinely provider-private and does not fit a typed axis (e.g. Bedrock's
   * `aws_credentials` / `aws_region` for SigV4). Anything used by more than
   * one route should grow into a typed field instead.
   */
  native: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export namespace ModelRef {
  export type Input = ConstructorParameters<typeof ModelRef>[0]

  export const input = (model: ModelRef): Input => ({
    id: model.id,
    provider: model.provider,
    route: model.route,
    baseURL: model.baseURL,
    apiKey: model.apiKey,
    auth: model.auth,
    headers: model.headers,
    queryParams: model.queryParams,
    limits: model.limits,
    generation: model.generation,
    providerOptions: model.providerOptions,
    http: model.http,
    native: model.native,
  })

  export const update = (model: ModelRef, patch: Partial<Input>) => {
    if (Object.keys(patch).length === 0) return model
    return new ModelRef({
      ...input(model),
      ...patch,
    })
  }
}

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
