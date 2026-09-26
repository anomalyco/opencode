export * as Provider from "./provider.js"

import { Effect, Schema } from "effect"
import { Integration } from "./integration.js"
import { optional, statics } from "./schema.js"
import { ephemeral, inventory } from "./event.js"

export const ID = Schema.String.pipe(
  Schema.brand("Provider.ID"),
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

const Updated = ephemeral({ type: "provider.updated", schema: {} })
export const Event = { Updated, Definitions: inventory(Updated) }

export const Package = Schema.String
export type Package = typeof Package.Type

export const Activation = Schema.Literals(["auto", "enabled", "disabled"])
export type Activation = typeof Activation.Type

export const Compaction = Schema.Union([
  Schema.Struct({ type: Schema.Literal("summary") }),
  Schema.Struct({ type: Schema.Literal("native") }),
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Provider.Compaction" })
export type Compaction = typeof Compaction.Type

/** "websocket" on a route without a WebSocket channel warns and falls back to HTTP. */
export const Transport = Schema.Literals(["http", "websocket"]).annotate({ identifier: "Provider.Transport" })
export type Transport = typeof Transport.Type

export const Settings = Schema.StructWithRest(
  Schema.Struct({
    timeout: Schema.Union([Schema.Finite, Schema.Literal(false)]).pipe(optional),
    chunkTimeout: Schema.Finite.pipe(optional),
    compaction: Compaction.pipe(optional),
    transport: Transport.pipe(optional),
  }),
  [Schema.Record(Schema.String, Schema.Any)],
).annotate({ identifier: "Provider.Settings" })
export type Settings = typeof Settings.Type

export const Overlays = {
  settings: Settings.pipe(optional),
  headers: Schema.Record(Schema.String, Schema.String).pipe(optional),
  body: Schema.Record(Schema.String, Schema.Any).pipe(optional),
}

export interface Request extends Schema.Schema.Type<typeof Request> {}
export const Request = Schema.Struct({
  settings: Settings.pipe(Schema.withConstructorDefault(Effect.succeed({}))),
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.Record(Schema.String, Schema.Any),
}).annotate({ identifier: "Provider.Request" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  canonical: ID.pipe(optional),
  integrationID: Integration.ID.pipe(optional),
  name: Schema.String,
  activation: Activation,
  package: Package,
  ...Overlays,
})
  .annotate({ identifier: "Provider.Info" })
  .pipe(
    statics(() => ({
      empty: (id: ID): Info => ({ id, name: id, activation: "auto", package: "" }),
    })),
  )
