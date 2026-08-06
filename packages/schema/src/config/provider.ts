export * as ConfigProvider from "./provider.js"

import { Schema } from "effect"
import { Money } from "../money.js"
import { Capabilities, Compatibility, Family, ID, VariantID } from "../model.js"

const JsonRecord = Schema.Record(Schema.String, Schema.Json)

export const Overlays = {
  settings: JsonRecord.pipe(Schema.optional),
  headers: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional),
  body: JsonRecord.pipe(Schema.optional),
}

export class Request extends Schema.Class<Request>("Config.Provider.Request")({
  headers: Overlays.headers,
  body: Overlays.body,
}) {}

class Cache extends Schema.Class<Cache>("Config.Model.Cost.Cache")({
  read: Money.USDPerMillionTokens.pipe(Schema.optional),
  write: Money.USDPerMillionTokens.pipe(Schema.optional),
}) {}

class Cost extends Schema.Class<Cost>("Config.Model.Cost")({
  tier: Schema.Struct({
    type: Schema.Literal("context"),
    size: Schema.Int,
  }).pipe(Schema.optional),
  input: Money.USDPerMillionTokens,
  output: Money.USDPerMillionTokens,
  cache: Cache.pipe(Schema.optional),
}) {}

class Limit extends Schema.Class<Limit>("Config.Model.Limit")({
  context: Schema.Int.pipe(Schema.optional),
  input: Schema.Int.pipe(Schema.optional),
  output: Schema.Int.pipe(Schema.optional),
}) {}

class Model extends Schema.Class<Model>("Config.Model")({
  modelID: ID.pipe(Schema.optional),
  family: Family.pipe(Schema.optional),
  name: Schema.String.pipe(Schema.optional),
  compatibility: Compatibility.pipe(Schema.optional),
  package: Schema.String.pipe(Schema.optional),
  ...Overlays,
  capabilities: Capabilities.pipe(Schema.optional),
  variants: Schema.Struct({
    id: VariantID,
    ...Overlays,
  }).pipe(Schema.Array, Schema.optional),
  cost: Schema.Union([Cost, Cost.pipe(Schema.Array)]).pipe(Schema.optional),
  disabled: Schema.Boolean.pipe(Schema.optional),
  limit: Limit.pipe(Schema.optional),
}) {}

export class Info extends Schema.Class<Info>("Config.Provider")({
  name: Schema.String.pipe(Schema.optional),
  env: Schema.String.pipe(Schema.Array, Schema.optional),
  package: Schema.String.pipe(Schema.optional),
  ...Overlays,
  models: Schema.Record(Schema.String, Model).pipe(Schema.optional),
}) {}
