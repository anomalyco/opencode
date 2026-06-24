export * as ProviderV2 from "./provider"

import { withStatics } from "./schema"
import { IntegrationSchema } from "./integration/schema"
import { Schema, Types } from "effect"

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
export type MutableApi<T extends Api = Api> = T extends Api
  ? Omit<Types.DeepMutable<T>, "settings"> & (undefined extends T["settings"] ? { settings?: any } : { settings: any })
  : never

export const Request = Schema.Struct({
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.Record(Schema.String, Schema.Any),
})
export type Request = typeof Request.Type

export class Info extends Schema.Class<Info>("ProviderV2.Info")({
  id: ID,
  integrationID: IntegrationSchema.ID.pipe(Schema.optional),
  name: Schema.String,
  disabled: Schema.Boolean.pipe(Schema.optional),
  api: Api,
  request: Request,
}) {
  static empty(providerID: ID): Info {
    return new Info({
      id: providerID,
      name: providerID,
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

export type MutableInfo = Omit<Types.DeepMutable<Info>, "api"> & { api: MutableApi }
