export * as Model from "./model.js"

import { Schema, Struct } from "effect"
import { optional, statics } from "./schema.js"
import { Provider } from "./provider.js"
import { Compatibility, MaxTokensField, ReasoningField } from "./model-compatibility.js"
import { Money } from "./money.js"
import { ephemeral, inventory } from "./event.js"

export const ID = Schema.String.pipe(Schema.brand("Model.ID"))
export type ID = typeof ID.Type

const Updated = ephemeral({ type: "model.updated", schema: {} })
export const Event = { Updated, Definitions: inventory(Updated) }

export const VariantID = Schema.String.pipe(Schema.brand("Model.VariantID"))
export type VariantID = typeof VariantID.Type

export const Ref = Schema.Struct({
  id: ID,
  providerID: Provider.ID,
  variant: VariantID.pipe(optional),
})
  .annotate({ identifier: "Model.Ref" })
  .pipe(
    statics((schema) => ({
      parse: (input: string) => {
        const providerEnd = input.indexOf("/")
        if (providerEnd <= 0) throw new Error(`Invalid model reference: ${input}`)
        const providerID = input.slice(0, providerEnd)
        const variantStart = input.indexOf("#", providerEnd + 1)
        const id = input.slice(providerEnd + 1, variantStart === -1 ? undefined : variantStart)
        const variant = variantStart === -1 ? undefined : input.slice(variantStart + 1)
        if (!id || providerID.includes("#") || (variant !== undefined && (!variant || variant.includes("#"))))
          throw new Error(`Invalid model reference: ${input}`)
        return schema.make({
          providerID: Provider.ID.make(providerID),
          id: ID.make(id),
          ...(variant ? { variant: VariantID.make(variant) } : {}),
        })
      },
    })),
  )
export interface Ref extends Schema.Schema.Type<typeof Ref> {}

export { Compatibility, MaxTokensField, ReasoningField }

export const Family = Schema.String.pipe(Schema.brand("Model.Family"))
export type Family = typeof Family.Type

/** What a model produces, from models.dev. Open-ended: new types keep being added. Only chat models are offered for sessions; an unset type means chat. */
export type Type = "chat" | "decision" | "image" | (string & {})
export const Type: Schema.Codec<Type> = Schema.Union([
  Schema.Literals(["chat", "decision", "image"]),
  Schema.String,
]).annotate({ identifier: "Model.Type" })

export const Settings = Schema.StructWithRest(
  Schema.Struct(Struct.pick(Provider.Settings.schema.fields, ["compaction", "cache", "encoding"])),
  // Provider packages may define arbitrary model-level options beyond OpenCode's shared compaction policy.
  [Schema.Record(Schema.String, Schema.Any)],
).annotate({ identifier: "Model.Settings" })
export type Settings = typeof Settings.Type

export const Overlays = {
  settings: Settings.pipe(optional),
  headers: Schema.Record(Schema.String, Schema.String).pipe(optional),
  body: Schema.Record(Schema.String, Schema.Any).pipe(optional),
}

export interface Capabilities extends Schema.Schema.Type<typeof Capabilities> {}
export const Capabilities = Schema.Struct({
  tools: Schema.Boolean,
  input: Schema.Array(Schema.String),
  output: Schema.Array(Schema.String),
  /** Whether the model accepts a sampling temperature. Unknown when unset. */
  temperature: Schema.Boolean.pipe(optional),
})
  .annotate({ identifier: "Model.Capabilities" })
  .pipe(
    statics(() => ({
      default: () => ({ tools: true, input: ["text", "image"], output: ["text"] }) satisfies Capabilities,
    })),
  )

export interface Cost extends Schema.Schema.Type<typeof Cost> {}
export const Cost = Schema.Struct({
  tier: Schema.Struct({
    type: Schema.tag("context"),
    size: Schema.Int,
  }).pipe(optional),
  input: Money.USDPerMillionTokens,
  output: Money.USDPerMillionTokens,
  cache: Schema.Struct({
    read: Money.USDPerMillionTokens,
    write: Money.USDPerMillionTokens,
  }),
}).annotate({ identifier: "Model.Cost" })

// Pricing carries a model's whole models.dev v2 cost, including what `cost` can't express: per image or
// second prices, audio and video, web search, cache TTLs, and region, date or time conditions. Prices are
// USD per 1M for the `token` (the default) and `character` units, and per 1 unit (image, second…) otherwise.

const PricingValue = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean])
const PricingComparable = Schema.Union([Schema.Finite, Schema.String])

/**
 * A comparison of one request property (`context`, `region`, `service_tier`, `utc_hours`… open-ended)
 * with exactly one operator, negated by `not`. Strings compare lexicographically, so ISO dates and
 * "HH:MM" times work.
 */
export interface PricingCondition extends Schema.Schema.Type<typeof PricingCondition> {}
export const PricingCondition = Schema.Struct({
  key: Schema.String,
  not: Schema.Boolean.pipe(optional),
  equals: PricingValue.pipe(optional),
  in: Schema.Array(PricingValue).pipe(optional),
  gt: PricingComparable.pipe(optional),
  gte: PricingComparable.pipe(optional),
  lt: PricingComparable.pipe(optional),
  lte: PricingComparable.pipe(optional),
  minItems: Schema.Int.pipe(optional),
}).annotate({ identifier: "Model.PricingCondition" })

/** When a rule applies: when any clause holds, and a clause holds when all its conditions do. `[[]]` always holds. */
export const PricingWhen = Schema.Array(Schema.Array(PricingCondition)).annotate({ identifier: "Model.PricingWhen" })
export type PricingWhen = typeof PricingWhen.Type

const PricingCachePrices = {
  read: Schema.Finite.pipe(optional),
  /** One price, or one per cache TTL (`"5m"`, `"1h"`…). */
  write: Schema.Union([Schema.Finite, Schema.Record(Schema.String, Schema.Finite)]).pipe(optional),
  /** Per 1M tokens per hour stored. */
  storage: Schema.Finite.pipe(optional),
}

export interface PricingCache extends Schema.Schema.Type<typeof PricingCache> {}
export const PricingCache = Schema.Struct({
  ...PricingCachePrices,
  /** Prices when the request asks for caching explicitly, where they differ from implicit caching. */
  explicit: Schema.Struct(PricingCachePrices).pipe(optional),
}).annotate({ identifier: "Model.PricingCache" })

export interface PricingInput extends Schema.Schema.Type<typeof PricingInput> {}
export const PricingInput = Schema.Struct({
  unit: Schema.String.pipe(optional),
  price: Schema.Finite,
  cache: PricingCache.pipe(optional),
  /** Applied in order, field by field, when they match. */
  overrides: Schema.Array(
    Schema.Struct({ when: PricingWhen, price: Schema.Finite.pipe(optional), cache: PricingCache.pipe(optional) }),
  ).pipe(optional),
}).annotate({ identifier: "Model.PricingInput" })

export interface PricingOutput extends Schema.Schema.Type<typeof PricingOutput> {}
export const PricingOutput = Schema.Struct({
  unit: Schema.String.pipe(optional),
  price: Schema.Finite,
  /** Reasoning tokens, when they cost other than `price`. */
  reasoning: Schema.Finite.pipe(optional),
  overrides: Schema.Array(
    Schema.Struct({
      when: PricingWhen,
      price: Schema.Finite.pipe(optional),
      reasoning: Schema.Finite.pipe(optional),
    }),
  ).pipe(optional),
}).annotate({ identifier: "Model.PricingOutput" })

export interface PricingModality extends Schema.Schema.Type<typeof PricingModality> {}
export const PricingModality = Schema.Struct({
  input: PricingInput.pipe(optional),
  output: PricingOutput.pipe(optional),
}).annotate({ identifier: "Model.PricingModality" })

/** USD per 1,000 web searches. */
export interface PricingWebSearch extends Schema.Schema.Type<typeof PricingWebSearch> {}
export const PricingWebSearch = Schema.Struct({
  price: Schema.Finite,
  overrides: Schema.Array(Schema.Struct({ when: PricingWhen, price: Schema.Finite.pipe(optional) })).pipe(optional),
}).annotate({ identifier: "Model.PricingWebSearch" })

/**
 * A number scales every price, web search included. A record scales only the prices under the dotted
 * paths it lists (`text`, `audio.input.cache.read`, `text.input.cache.write.5m`, `webSearch`…).
 */
export const PricingFactor = Schema.Union([Schema.Finite, Schema.Record(Schema.String, Schema.Finite)]).annotate({
  identifier: "Model.PricingFactor",
})
export type PricingFactor = typeof PricingFactor.Type

const PricingStruct = Schema.Struct({
  /** The service tier this model's requests run on, for `service_tier` conditions. Unset is the default tier. */
  serviceTier: Schema.String.pipe(optional),
  text: PricingModality.pipe(optional),
  image: PricingModality.pipe(optional),
  audio: PricingModality.pipe(optional),
  video: PricingModality.pipe(optional),
  webSearch: PricingWebSearch.pipe(optional),
  /** Applied after overrides; every matching multiplier applies. */
  multipliers: Schema.Array(Schema.Struct({ when: PricingWhen, factor: PricingFactor })).pipe(optional),
}).annotate({ identifier: "Model.Pricing" })
export interface Pricing extends Schema.Schema.Type<typeof PricingStruct> {}
// Typed by name, so declarations of Model.Info stay within the compiler's size limit.
export const Pricing: Schema.Codec<Pricing> = PricingStruct

export interface Variant extends Schema.Schema.Type<typeof Variant> {}
export const Variant = Schema.Struct({
  id: VariantID,
  ...Overlays,
}).annotate({ identifier: "Model.Variant" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  modelID: ID,
  providerID: Provider.ID,
  canonical: Provider.ID.pipe(optional),
  type: Type.pipe(optional),
  family: Family.pipe(optional),
  name: Schema.String,
  compatibility: Compatibility.pipe(optional),
  package: Provider.Package.pipe(optional),
  ...Overlays,
  capabilities: Capabilities,
  variants: Schema.Array(Variant),
  time: Schema.Struct({
    released: Schema.Finite,
  }),
  cost: Schema.Array(Cost),
  pricing: Pricing.pipe(optional),
  status: Schema.Literals(["alpha", "beta", "deprecated", "active"]),
  enabled: Schema.Boolean,
  limit: Schema.Struct({
    context: Schema.Int,
    input: Schema.Int.pipe(optional),
    output: Schema.Int,
  }),
})
  .annotate({ identifier: "Model.Info" })
  .pipe(
    statics(() => ({
      default: (providerID: Provider.ID, id: ID) =>
        ({
          id,
          modelID: id,
          providerID,
          name: id,
          capabilities: Capabilities.default(),
          variants: [],
          time: { released: 0 },
          cost: [],
          status: "active",
          enabled: true,
          limit: { context: 200_000, output: 32_000 },
        }) satisfies Info,
    })),
  )
