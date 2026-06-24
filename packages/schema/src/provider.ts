export * as Provider from "./provider"

import { Schema } from "effect"
import { Integration } from "./integration"
import { withStatics } from "./schema"

export const ID = Schema.String.pipe(
  Schema.brand("ProviderV2.ID"),
  withStatics((schema) => ({
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

export interface AISDK extends Schema.Schema.Type<typeof AISDK> {}
export const AISDK = Schema.Struct({
  type: Schema.Literal("aisdk"),
  package: Schema.String,
  url: Schema.String.pipe(Schema.optional),
  settings: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
})

export interface Native extends Schema.Schema.Type<typeof Native> {}
export const Native = Schema.Struct({
  type: Schema.Literal("native"),
  url: Schema.String.pipe(Schema.optional),
  settings: Schema.Record(Schema.String, Schema.Unknown),
})

export const Api = Schema.Union([AISDK, Native]).pipe(Schema.toTaggedUnion("type"))
export type Api = typeof Api.Type

export interface Request extends Schema.Schema.Type<typeof Request> {}
export const Request = Schema.Struct({
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.Record(Schema.String, Schema.Any),
})

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  integrationID: Integration.ID.pipe(Schema.optional),
  name: Schema.String,
  disabled: Schema.Boolean.pipe(Schema.optional),
  api: Api,
  request: Request,
})
  .annotate({ identifier: "ProviderV2.Info" })
  .pipe(
    withStatics((schema) => ({
      empty: (id: ID) =>
        schema.make({
          id,
          name: id,
          api: { type: "native", settings: {} },
          request: { headers: {}, body: {} },
        }),
    })),
  )
