export * as ConfigMarketplaceV1 from "./marketplace"

import { Schema } from "effect"

export const Trust = Schema.Literals(["official", "verified", "community", "private"])
export const Kind = Schema.Literals(["plugin", "skill", "agent", "command", "mcp", "bundle"])

export const Source = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.String,
  enabled: Schema.optional(Schema.Boolean),
  trust: Schema.optional(Trust),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})

export const Installed = Schema.Struct({
  source: Schema.String,
  source_url: Schema.optional(Schema.String),
  source_trust: Schema.optional(Trust),
  catalog: Schema.String,
  catalog_name: Schema.optional(Schema.String),
  item: Schema.String,
  name: Schema.String,
  kind: Kind,
  version: Schema.String,
  publisher: Schema.optional(Schema.String),
  fingerprint: Schema.String,
  installed_at: Schema.String,
  updated_at: Schema.String,
  snapshot: Schema.optional(Schema.Unknown),
  plan: Schema.Unknown,
  active_plan: Schema.optional(Schema.Unknown),
  receipt: Schema.Unknown,
  enabled: Schema.optional(Schema.Boolean),
  disabled_skills: Schema.optional(Schema.Array(Schema.String)),
  disabled_mcp: Schema.optional(Schema.Array(Schema.String)),
})

export const Info = Schema.Struct({
  revision: Schema.optional(Schema.Number),
  sources: Schema.optional(Schema.mutable(Schema.Array(Source))),
  installed: Schema.optional(Schema.Record(Schema.String, Installed)),
})

export type Info = Schema.Schema.Type<typeof Info>
