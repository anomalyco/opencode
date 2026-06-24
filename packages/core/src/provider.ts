export * as ProviderV2 from "./provider"

import { IntegrationSchema } from "./integration/schema"
import { Schema, Types } from "effect"
import { Provider } from "@opencode-ai/schema/provider"

export const ID = Provider.ID
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
