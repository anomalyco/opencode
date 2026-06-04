export * as ProviderV2 from "./provider"

import { withStatics } from "./schema"
import { Schema } from "effect"

export const ID = Schema.String.pipe(
  Schema.brand("ProviderV2.ID"),
  withStatics((schema) => ({
    // Well-known providers
    opencode: schema.make("opencode"),
    anthropic: schema.make("anthropic"),
    openai: schema.make("openai"),
    google: schema.make("google"),
    googleVertex: schema.make("google-vertex"),
    githubCopilot: schema.make("github-copilot"),
    amazonBedrock: schema.make("amazon-bedrock"),
    azure: schema.make("azure"),
    openrouter: schema.make("openrouter"),
    mistral: schema.make("mistral"),
    gitlab: schema.make("gitlab"),
  })),
)
export type ID = typeof ID.Type

export const ModelID = Schema.String.pipe(Schema.brand("ModelID"))
export type ModelID = typeof ModelID.Type

export const AISDK = Schema.Struct({
  type: Schema.Literal("aisdk"),
  package: Schema.String,
  url: Schema.String.pipe(Schema.optional),
  settings: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
})

export const Native = Schema.Struct({
  type: Schema.Literal("native"),
  url: Schema.String.pipe(Schema.optional),
  settings: Schema.Record(Schema.String, Schema.Unknown),
})

export const Api = Schema.Union([AISDK, Native]).pipe(Schema.toTaggedUnion("type"))
export type Api = typeof Api.Type

export const PublicAISDK = Schema.Struct({
  type: Schema.Literal("aisdk"),
  package: Schema.String,
  url: Schema.String.pipe(Schema.optional),
})

export const PublicNative = Schema.Struct({
  type: Schema.Literal("native"),
  url: Schema.String.pipe(Schema.optional),
})

export const PublicApi = Schema.Union([PublicAISDK, PublicNative]).pipe(Schema.toTaggedUnion("type"))
export type PublicApi = typeof PublicApi.Type

export const Request = Schema.Struct({
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.Record(Schema.String, Schema.Any),
})
export type Request = typeof Request.Type

export class Info extends Schema.Class<Info>("ProviderV2.Info")({
  id: ID,
  name: Schema.String,
  enabled: Schema.Union([
    Schema.Literal(false),
    Schema.Struct({
      via: Schema.Literal("env"),
      name: Schema.String,
    }),
    Schema.Struct({
      via: Schema.Literal("account"),
      service: Schema.String,
    }),
    Schema.Struct({
      via: Schema.Literal("custom"),
      data: Schema.Record(Schema.String, Schema.Any),
    }),
  ]),
  env: Schema.String.pipe(Schema.Array),
  api: Api,
  request: Request,
}) {
  static empty(providerID: ID): Info {
    return new Info({
      id: providerID,
      name: providerID,
      enabled: false,
      env: [],
      api: {
        type: "native",
        settings: {},
      },
      request: {
        headers: {},
        body: {},
      },
    })
  }
}

export class PublicInfo extends Schema.Class<PublicInfo>("ProviderV2.PublicInfo")({
  id: ID,
  name: Schema.String,
  enabled: Schema.Union([
    Schema.Literal(false),
    Schema.Struct({
      via: Schema.Literal("env"),
      name: Schema.String,
    }),
    Schema.Struct({
      via: Schema.Literal("account"),
      service: Schema.String,
    }),
    Schema.Struct({
      via: Schema.Literal("custom"),
    }),
  ]),
  env: Schema.String.pipe(Schema.Array),
  api: PublicApi,
}) {}

export function sanitizePublicUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined
  } catch {
    return undefined
  }
}

export function toPublic(info: Info): PublicInfo {
  const enabled = info.enabled === false || info.enabled.via !== "custom" ? info.enabled : { via: "custom" as const }
  const api =
    info.api.type === "aisdk"
      ? { type: info.api.type, package: info.api.package, url: sanitizePublicUrl(info.api.url) }
      : { type: info.api.type, url: sanitizePublicUrl(info.api.url) }
  return new PublicInfo({
    id: info.id,
    name: info.name,
    enabled,
    env: [...info.env],
    api,
  })
}
