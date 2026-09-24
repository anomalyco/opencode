export * as ConfigProvider from "./provider.js"

import { Schema } from "effect"
import { CachePolicy } from "../cache.js"
import { Money } from "../money.js"
import { Capabilities, Compatibility, Family, ID, VariantID } from "../model.js"
import { Provider } from "../provider.js"
import { optional } from "../schema.js"

export const Settings = Schema.StructWithRest(
  Schema.Struct({
    timeout: Schema.Union([Schema.Finite, Schema.Literal(false)]).pipe(optional),
    chunkTimeout: Schema.Finite.pipe(optional),
    compaction: Provider.Compaction.pipe(optional),
    transport: Provider.Transport.pipe(optional),
  }),
  [Schema.Record(Schema.String, Schema.UndefinedOr(Schema.Json))],
).annotate({ identifier: "Config.Provider.Settings" })
export type Settings = typeof Settings.Type

export const ModelSettings = Schema.StructWithRest(
  Schema.Struct({
    compaction: Provider.Compaction.pipe(optional),
  }),
  [Schema.Record(Schema.String, Schema.UndefinedOr(Schema.Json))],
).annotate({ identifier: "Config.Model.Settings" })
export type ModelSettings = typeof ModelSettings.Type

const JsonRecord = Schema.Record(Schema.String, Schema.Json)

export const Overlays = {
  settings: Settings.pipe(optional),
  headers: Schema.Record(Schema.String, Schema.String).pipe(optional),
  body: JsonRecord.pipe(optional),
}

const ModelOverlays = {
  settings: ModelSettings.pipe(optional),
  headers: Schema.Record(Schema.String, Schema.String).pipe(optional),
  body: JsonRecord.pipe(optional),
}

export class Request extends Schema.Class<Request>("Config.Provider.Request")({
  headers: Overlays.headers,
  body: Overlays.body,
}) {}

class Cache extends Schema.Class<Cache>("Config.Model.Cost.Cache")({
  read: Money.USDPerMillionTokens.pipe(optional),
  write: Money.USDPerMillionTokens.pipe(optional),
}) {}

class Cost extends Schema.Class<Cost>("Config.Model.Cost")({
  tier: Schema.Struct({
    type: Schema.Literal("context"),
    size: Schema.Int,
  }).pipe(optional),
  input: Money.USDPerMillionTokens,
  output: Money.USDPerMillionTokens,
  cache: Cache.pipe(optional),
}) {}

class Limit extends Schema.Class<Limit>("Config.Model.Limit")({
  context: Schema.Int.pipe(optional),
  input: Schema.Int.pipe(optional),
  output: Schema.Int.pipe(optional),
}) {}

class Model extends Schema.Class<Model>("Config.Model")({
  modelID: ID.pipe(optional),
  family: Family.pipe(optional),
  name: Schema.String.pipe(optional),
  compatibility: Compatibility.pipe(optional),
  package: Schema.String.pipe(optional),
  ...ModelOverlays,
  cache: CachePolicy.Policy.pipe(optional),
  capabilities: Capabilities.pipe(optional),
  variants: Schema.Struct({
    id: VariantID,
    ...ModelOverlays,
  }).pipe(Schema.Array, optional),
  cost: Schema.Union([Cost, Cost.pipe(Schema.Array)]).pipe(optional),
  disabled: Schema.Boolean.pipe(optional),
  limit: Limit.pipe(optional),
}) {}

export class Info extends Schema.Class<Info>("Config.Provider")({
  canonical: Provider.ID.pipe(optional),
  name: Schema.String.pipe(optional),
  env: Schema.String.pipe(Schema.Array, optional),
  package: Schema.String.pipe(optional),
  ...Overlays,
  cache: CachePolicy.Policy.pipe(optional),
  models: Schema.Record(Schema.String, Model).pipe(optional),
}) {}
