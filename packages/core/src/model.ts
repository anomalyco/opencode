import { DateTime, Schema } from "effect"
import { DateTimeUtcFromMillis } from "effect/Schema"
import { ProviderV2 } from "./provider"

export const ID = Schema.String.pipe(Schema.brand("ModelV2.ID"))
export type ID = typeof ID.Type

export const VariantID = Schema.String.pipe(Schema.brand("VariantID"))
export type VariantID = typeof VariantID.Type

// Grouping of models, eg claude opus, claude sonnet
export const Family = Schema.String.pipe(Schema.brand("Family"))
export type Family = typeof Family.Type

export const Capabilities = Schema.Struct({
  tools: Schema.Boolean,
  // mime patterns, image, audio, video/*, text/*
  input: Schema.String.pipe(Schema.Array),
  output: Schema.String.pipe(Schema.Array),
})
export type Capabilities = typeof Capabilities.Type

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

export const Ref = Schema.Struct({
  id: ID,
  providerID: ProviderV2.ID,
  variant: VariantID,
})
export type Ref = typeof Ref.Type

export class Info extends Schema.Class<Info>("ModelV2.Info")({
  id: ID,
  apiID: ID,
  providerID: ProviderV2.ID,
  family: Family.pipe(Schema.optional),
  name: Schema.String,
  endpoint: ProviderV2.Endpoint,
  capabilities: Capabilities,
  options: Schema.Struct({
    ...ProviderV2.Options.fields,
    variant: Schema.String.pipe(Schema.optional),
  }),
  variants: Schema.Struct({
    id: VariantID,
    ...ProviderV2.Options.fields,
  }).pipe(Schema.Array),
  time: Schema.Struct({
    released: DateTimeUtcFromMillis,
  }),
  cost: Cost.pipe(Schema.Array),
  status: Schema.Literals(["alpha", "beta", "deprecated", "active"]),
  enabled: Schema.Boolean,
  limit: Schema.Struct({
    context: Schema.Int,
    input: Schema.Int.pipe(Schema.optional),
    output: Schema.Int,
  }),
}) {
  static empty(providerID: ProviderV2.ID, modelID: ID) {
    return new Info({
      id: modelID,
      apiID: modelID,
      providerID,
      name: modelID,
      endpoint: {
        type: "unknown",
      },
      capabilities: {
        tools: false,
        input: [],
        output: [],
      },
      options: {
        headers: {},
        body: {},
        aisdk: {
          provider: {},
          request: {},
        },
      },
      variants: [],
      time: {
        released: DateTime.makeUnsafe(0),
      },
      cost: [],
      status: "active",
      enabled: true,
      limit: {
        context: 0,
        output: 0,
      },
    })
  }
}

export function parse(input: string): { providerID: ProviderV2.ID; modelID: ID } {
  const [providerID, ...modelID] = input.split("/")
  return {
    providerID: ProviderV2.ID.make(providerID),
    modelID: ID.make(modelID.join("/")),
  }
}

export * as ModelV2 from "./model"
