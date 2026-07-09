export * as Model from "./model.js"

import { Schema } from "effect"
import { optional, statics } from "./schema.js"
import { Provider } from "./provider.js"
import { Money } from "./money.js"

export const ID = Schema.String.pipe(Schema.brand("Model.ID"))
export type ID = typeof ID.Type

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

export const Family = Schema.String.pipe(Schema.brand("Model.Family"))
export type Family = typeof Family.Type

export interface Capabilities extends Schema.Schema.Type<typeof Capabilities> {}
export const Capabilities = Schema.Struct({
  tools: Schema.Boolean,
  input: Schema.Array(Schema.String),
  output: Schema.Array(Schema.String),
}).annotate({ identifier: "Model.Capabilities" })

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

export interface Variant extends Schema.Schema.Type<typeof Variant> {}
export const Variant = Schema.Struct({
  id: VariantID,
  ...Provider.Overlays,
}).annotate({ identifier: "Model.Variant" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  modelID: ID,
  providerID: Provider.ID,
  family: Family.pipe(optional),
  name: Schema.String,
  package: Provider.Package.pipe(optional),
  ...Provider.Overlays,
  capabilities: Capabilities,
  variants: Schema.Array(Variant),
  time: Schema.Struct({
    released: Schema.Finite,
  }),
  cost: Schema.Array(Cost),
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
    statics((schema) => ({
      empty: (providerID: Provider.ID, id: ID) =>
        schema.make({
          id,
          modelID: id,
          providerID,
          name: id,
          capabilities: { tools: false, input: [], output: [] },
          variants: [],
          time: { released: 0 },
          cost: [],
          status: "active",
          enabled: true,
          limit: { context: 0, output: 0 },
        }),
    })),
  )
