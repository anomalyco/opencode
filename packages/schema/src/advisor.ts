export * as Advisor from "./advisor.js"

import { Schema } from "effect"
import { Rpc } from "./rpc.js"

export const State = Schema.Union([
  Schema.Struct({ mode: Schema.Literal("off") }),
  Schema.Struct({
    mode: Schema.Literals(["full", "secure"]),
    model: Schema.Struct({ providerID: Schema.String, id: Schema.String }),
  }),
]).annotate({ identifier: "Advisor.State" })
export type State = typeof State.Type

/**
 * The advisor plugin's RPC: one setting for the whole server, kept in plugin storage so it survives restarts. Clients
 * read it with `get`, change it with `set`, and follow `changed`, which the plugin publishes on every `set`.
 */
export const Definition = Rpc.define({
  id: "opencode.advisor",
  methods: {
    get: { input: Schema.toStandardSchemaV1(Schema.Struct({})), output: Schema.toStandardSchemaV1(State) },
    set: { input: Schema.toStandardSchemaV1(State), output: Schema.toStandardSchemaV1(State) },
  },
  events: { changed: { schema: Schema.toStandardSchemaV1(State) } },
})
