export * as WebSearch from "./websearch.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { optional } from "./schema.js"

export const ID = Schema.String.pipe(Schema.brand("WebSearch.ID"))
export type ID = typeof ID.Type

export interface Provider extends Schema.Schema.Type<typeof Provider> {}
export const Provider = Schema.Struct({
  id: ID,
  name: Schema.String,
}).annotate({ identifier: "WebSearch.Provider" })

export interface Input extends Schema.Schema.Type<typeof Input> {}
export const Input = Schema.Struct({
  query: Schema.String,
  providerID: ID.pipe(optional),
}).annotate({ identifier: "WebSearch.Input" })
export type ProviderInput = Pick<Input, "query">

export interface ProviderOutput extends Schema.Schema.Type<typeof ProviderOutput> {}
export const ProviderOutput = Schema.Struct({
  text: Schema.String,
  metadata: Schema.Json.pipe(optional),
}).annotate({ identifier: "WebSearch.ProviderOutput" })

export class Result extends Schema.Class<Result>("WebSearch.Result")({
  providerID: ID,
  ...ProviderOutput.fields,
}) {}

const Updated = ephemeral({
  type: "websearch.updated",
  schema: {},
})
export const Event = { Updated, Definitions: inventory(Updated) }
