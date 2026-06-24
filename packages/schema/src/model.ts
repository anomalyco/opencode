export * as Model from "./model"

import { Schema } from "effect"
import { ModelRequest } from "./model-request"
import { Provider } from "./provider"
import { withStatics } from "./schema"

export const ID = Schema.String.pipe(Schema.brand("ModelV2.ID"))
export type ID = typeof ID.Type

export const VariantID = Schema.String.pipe(Schema.brand("VariantID"))
export type VariantID = typeof VariantID.Type

export const Ref = Schema.Struct({
  id: ID,
  providerID: Provider.ID,
  variant: VariantID.pipe(Schema.optional),
})
export type Ref = typeof Ref.Type

export const Family = Schema.String.pipe(Schema.brand("Family"))
export type Family = typeof Family.Type

export interface Capabilities extends Schema.Schema.Type<typeof Capabilities> {}
export const Capabilities = Schema.Struct({
  tools: Schema.Boolean,
  input: Schema.String.pipe(Schema.Array, Schema.mutable),
  output: Schema.String.pipe(Schema.Array, Schema.mutable),
})

export interface Cost extends Schema.Schema.Type<typeof Cost> {}
export const Cost = Schema.Struct({
  tier: Schema.Struct({
    type: Schema.Literal("context"),
    size: Schema.Int,
  }).pipe(Schema.optional),
  input: Schema.Finite,
  output: Schema.Finite,
  cache: Schema.Struct({
    read: Schema.Finite,
    write: Schema.Finite,
  }),
})

export const Api = Schema.Union([
  Schema.Struct({
    id: ID,
    ...Provider.AISDK.fields,
  }),
  Schema.Struct({
    id: ID,
    ...Provider.Native.fields,
  }),
]).pipe(Schema.toTaggedUnion("type"))
export type Api = typeof Api.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  providerID: Provider.ID,
  family: Family.pipe(Schema.optional),
  name: Schema.String,
  api: Api,
  capabilities: Capabilities,
  request: Schema.Struct({
    ...ModelRequest.Request.fields,
    variant: Schema.String.pipe(Schema.optional),
  }),
  variants: Schema.Struct({
    id: VariantID,
    ...ModelRequest.Request.fields,
  }).pipe(Schema.Array, Schema.mutable),
  time: Schema.Struct({
    released: Schema.Finite,
  }),
  cost: Cost.pipe(Schema.Array, Schema.mutable),
  status: Schema.Literals(["alpha", "beta", "deprecated", "active"]),
  enabled: Schema.Boolean,
  limit: Schema.Struct({
    context: Schema.Int,
    input: Schema.Int.pipe(Schema.optional),
    output: Schema.Int,
  }),
})
  .annotate({ identifier: "ModelV2.Info" })
  .pipe(
    withStatics((schema) => ({
      empty: (providerID: Provider.ID, modelID: ID) =>
        schema.make({
          id: modelID,
          providerID,
          name: modelID,
          api: { id: modelID, type: "native", settings: {} },
          capabilities: { tools: false, input: [], output: [] },
          request: { headers: {}, body: {}, generation: {}, options: {} },
          variants: [],
          time: { released: 0 },
          cost: [],
          status: "active",
          enabled: true,
          limit: { context: 0, output: 0 },
        }),
    })),
  )
