export * as Provider from "./provider.js"

import { Effect, Schema } from "effect"
import { Integration } from "./integration.js"
import { optional, statics } from "./schema.js"

export const ID = Schema.String.pipe(
  Schema.brand("ProviderV2.ID"),
  statics((schema) => ({
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

export const Package = Schema.String
export type Package = typeof Package.Type

export const Overlays = {
  settings: Schema.Record(Schema.String, Schema.Json).pipe(optional),
  headers: Schema.Record(Schema.String, Schema.String).pipe(optional),
  body: Schema.Record(Schema.String, Schema.Json).pipe(optional),
}

export const Settings = Schema.Record(Schema.String, Schema.Json).annotate({ identifier: "Provider.Settings" })
export type Settings = typeof Settings.Type

export interface Request extends Schema.Schema.Type<typeof Request> {}
export const Request = Schema.Struct({
  settings: Settings.pipe(Schema.withConstructorDefault(Effect.succeed({}))),
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.Record(Schema.String, Schema.Json),
}).annotate({ identifier: "Provider.Request" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  integrationID: Integration.ID.pipe(optional),
  name: Schema.String,
  disabled: Schema.Boolean.pipe(optional),
  package: Package,
  ...Overlays,
})
  .annotate({ identifier: "ProviderV2.Info" })
  .pipe(
    statics(() => ({
      empty: (id: ID): Info => ({ id, name: id, package: "" }),
    })),
  )
