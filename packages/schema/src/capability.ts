export * as Capability from "./capability.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { optional } from "./schema.js"

export const Kind = Schema.Literal("skill")
export type Kind = typeof Kind.Type

export interface Ref extends Schema.Schema.Type<typeof Ref> {}
export const Ref = Schema.Struct({
  kind: Kind,
  key: Schema.NonEmptyArray(Schema.String),
}).annotate({ identifier: "Capability.Ref" })

export const State = Schema.Literals(["enabled", "disabled"])
export type State = typeof State.Type

export interface Preference extends Schema.Schema.Type<typeof Preference> {}
export const Preference = Schema.Struct({
  ref: Ref,
  state: State,
}).annotate({ identifier: "Capability.Preference" })

export interface Update extends Schema.Schema.Type<typeof Update> {}
export const Update = Schema.Struct({
  ref: Ref,
  state: Schema.Union([State, Schema.Literal("inherit")]),
}).annotate({ identifier: "Capability.Update" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  ref: Ref,
  name: Schema.String,
  description: Schema.String.pipe(optional),
  defaultState: State,
  state: State,
  preference: State.pipe(optional),
}).annotate({ identifier: "Capability.Info" })

const Updated = ephemeral({ type: "capability.updated", schema: { ref: Ref } })
export const Event = { Updated, Definitions: inventory(Updated) }
