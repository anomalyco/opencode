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
  variant: VariantID.pipe(Schema.optional),
})
export type Ref = typeof Ref.Type

export const Api = Schema.Union([
  Schema.Struct({
    id: ID,
    ...ProviderV2.AISDK.fields,
  }),
  Schema.Struct({
    id: ID,
    ...ProviderV2.Native.fields,
  }),
]).pipe(Schema.toTaggedUnion("type"))
export type Api = typeof Api.Type

export const PublicApi = Schema.Union([
  Schema.Struct({
    id: ID,
    ...ProviderV2.PublicAISDK.fields,
  }),
  Schema.Struct({
    id: ID,
    ...ProviderV2.PublicNative.fields,
  }),
]).pipe(Schema.toTaggedUnion("type"))
export type PublicApi = typeof PublicApi.Type

export class Info extends Schema.Class<Info>("ModelV2.Info")({
  id: ID,
  providerID: ProviderV2.ID,
  family: Family.pipe(Schema.optional),
  name: Schema.String,
  api: Api,
  capabilities: Capabilities,
  request: Schema.Struct({
    ...ProviderV2.Request.fields,
    variant: Schema.String.pipe(Schema.optional),
  }),
  variants: Schema.Struct({
    id: VariantID,
    ...ProviderV2.Request.fields,
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
  static empty(providerID: ProviderV2.ID, modelID: ID): Info {
    return new Info({
      id: modelID,
      providerID,
      name: modelID,
      api: {
        id: modelID,
        type: "native",
        settings: {},
      },
      capabilities: {
        tools: false,
        input: [],
        output: [],
      },
      request: {
        headers: {},
        body: {},
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

export class PublicInfo extends Schema.Class<PublicInfo>("ModelV2.PublicInfo")({
  id: ID,
  providerID: ProviderV2.ID,
  family: Family.pipe(Schema.optional),
  name: Schema.String,
  api: PublicApi,
  capabilities: Capabilities,
  variants: Schema.Struct({
    id: VariantID,
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
}) {}

export function toPublic(info: Info): PublicInfo {
  const api =
    info.api.type === "aisdk"
      ? {
          id: info.api.id,
          type: info.api.type,
          package: info.api.package,
          url: ProviderV2.sanitizePublicUrl(info.api.url),
        }
      : { id: info.api.id, type: info.api.type, url: ProviderV2.sanitizePublicUrl(info.api.url) }
  return new PublicInfo({
    id: info.id,
    providerID: info.providerID,
    family: info.family,
    name: info.name,
    api,
    capabilities: {
      tools: info.capabilities.tools,
      input: [...info.capabilities.input],
      output: [...info.capabilities.output],
    },
    variants: info.variants.map((variant) => ({ id: variant.id })),
    time: { released: info.time.released },
    cost: info.cost.map((cost) => ({
      tier: cost.tier && { ...cost.tier },
      input: cost.input,
      output: cost.output,
      cache: { ...cost.cache },
    })),
    status: info.status,
    enabled: info.enabled,
    limit: { ...info.limit },
  })
}

export function parse(input: string): { providerID: ProviderV2.ID; modelID: ID } {
  const [providerID, ...modelID] = input.split("/")
  return {
    providerID: ProviderV2.ID.make(providerID),
    modelID: ID.make(modelID.join("/")),
  }
}

export * as ModelV2 from "./model"
