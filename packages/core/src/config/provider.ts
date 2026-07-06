export * as ConfigProvider from "./provider"

import { Schema } from "effect"
import { ModelV2 } from "../model"

export const Overlays = {
  settings: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
  headers: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional),
  body: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
}

export class Request extends Schema.Class<Request>("ConfigV2.Provider.Request")({
  headers: Overlays.headers,
  body: Overlays.body,
}) {}

class Cache extends Schema.Class<Cache>("ConfigV2.Model.Cost.Cache")({
  read: Schema.Finite.pipe(Schema.optional),
  write: Schema.Finite.pipe(Schema.optional),
}) {}

class Cost extends Schema.Class<Cost>("ConfigV2.Model.Cost")({
  tier: Schema.Struct({
    type: Schema.Literal("context"),
    size: Schema.Int,
  }).pipe(Schema.optional),
  input: Schema.Finite,
  output: Schema.Finite,
  cache: Cache.pipe(Schema.optional),
}) {}

class Limit extends Schema.Class<Limit>("ConfigV2.Model.Limit")({
  context: Schema.Int.pipe(Schema.optional),
  input: Schema.Int.pipe(Schema.optional),
  output: Schema.Int.pipe(Schema.optional),
}) {}

class Model extends Schema.Class<Model>("ConfigV2.Model")({
  modelID: ModelV2.ID.pipe(Schema.optional),
  family: ModelV2.Family.pipe(Schema.optional),
  name: Schema.String.pipe(Schema.optional),
  package: Schema.String.pipe(Schema.optional),
  ...Overlays,
  capabilities: ModelV2.Capabilities.pipe(Schema.optional),
  variants: Schema.Struct({
    id: ModelV2.VariantID,
    ...Overlays,
  }).pipe(Schema.Array, Schema.optional),
  cost: Schema.Union([Cost, Cost.pipe(Schema.Array)]).pipe(Schema.optional),
  disabled: Schema.Boolean.pipe(Schema.optional),
  limit: Limit.pipe(Schema.optional),
}) {}

export class Info extends Schema.Class<Info>("ConfigV2.Provider")({
  name: Schema.String.pipe(Schema.optional),
  env: Schema.String.pipe(Schema.Array, Schema.optional),
  package: Schema.String.pipe(Schema.optional),
  ...Overlays,
  models: Schema.Record(Schema.String, Model).pipe(Schema.optional),
}) {}
