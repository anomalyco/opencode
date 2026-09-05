export * as ConfigProvider from "./provider.js"

import { Schema } from "effect"
import { Money } from "../money.js"
import { Capabilities, Compatibility, Family, ID, VariantID } from "../model.js"
import { Provider } from "../provider.js"
import { optional } from "../schema.js"

const JsonRecord = Schema.Record(Schema.String, Schema.Json)

export const Overlays = {
  settings: JsonRecord.pipe(optional),
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
  ...Overlays,
  capabilities: Capabilities.pipe(optional),
  variants: Schema.Struct({
    id: VariantID,
    ...Overlays,
  }).pipe(Schema.Array, optional),
  cost: Schema.Union([Cost, Cost.pipe(Schema.Array)]).pipe(optional),
  disabled: Schema.Boolean.pipe(optional),
  limit: Limit.pipe(optional),
}) {}

export interface OAuth extends Schema.Schema.Type<typeof OAuth> {}
export const OAuth = Schema.Struct({
  grantType: Schema.Literal("client_credentials"),
  tokenUrl: Schema.NonEmptyString,
  clientId: Schema.NonEmptyString,
  clientSecret: Schema.NonEmptyString,
  clientAuthMethod: Schema.Literals(["client_secret_basic", "client_secret_post"]).pipe(optional),
  scope: Schema.String.pipe(optional),
  audience: Schema.String.pipe(optional),
  resource: Schema.String.pipe(optional),
}).annotate({ identifier: "Config.Provider.OAuth" })

export class Info extends Schema.Class<Info>("Config.Provider")({
  canonical: Provider.ID.pipe(optional),
  name: Schema.String.pipe(optional),
  env: Schema.String.pipe(Schema.Array, optional),
  package: Schema.String.pipe(optional),
  oauth: OAuth.pipe(optional),
  ...Overlays,
  models: Schema.Record(Schema.String, Model).pipe(optional),
}) {}
