export * as WebSearch from "./websearch.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { optional } from "./schema.js"

export const ID = Schema.String.pipe(Schema.brand("WebSearch.ID"), Schema.annotate({ identifier: "WebSearch.ID" }))
export type ID = typeof ID.Type

export interface Provider extends Schema.Schema.Type<typeof Provider> {}
export const Provider = Schema.Struct({
  id: ID,
  name: Schema.String,
}).annotate({ identifier: "WebSearch.Provider" })

export interface Settings extends Schema.Schema.Type<typeof Settings> {}
export const Settings = Schema.Struct({
  endpoint: Schema.String.pipe(optional).annotate({
    description:
      "Search API endpoint to use instead of the provider's hosted service. The stored or environment credential is not forwarded to a custom endpoint; set apiKey explicitly.",
  }),
  apiKey: Schema.String.pipe(optional).annotate({
    description: "API key for the provider, used in place of a stored or environment credential",
  }),
}).annotate({ identifier: "WebSearch.Settings" })

export interface Input extends Schema.Schema.Type<typeof Input> {}
export const Input = Schema.Struct({
  query: Schema.String,
  providerID: ID.pipe(optional),
}).annotate({ identifier: "WebSearch.Input" })
export type ProviderInput = Pick<Input, "query">

export interface Result extends Schema.Schema.Type<typeof Result> {}
export const Result = Schema.Struct({
  url: Schema.String,
  title: Schema.String.pipe(optional),
  content: Schema.String.pipe(optional),
  time: Schema.Struct({
    published: Schema.Finite.pipe(optional).annotate({
      description: "Publication time in milliseconds since the Unix epoch",
    }),
  }),
}).annotate({ identifier: "WebSearch.Result" })

export class Response extends Schema.Class<Response>("WebSearch.Response")({
  providerID: ID,
  results: Schema.Array(Result),
}) {}

const Updated = ephemeral({
  type: "websearch.updated",
  schema: {},
})
export const Event = { Updated, Definitions: inventory(Updated) }
