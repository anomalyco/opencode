export * as ConfigPolicy from "./policy.js"

import { Schema } from "effect"

export const Effect = Schema.Literals(["allow", "deny"])
export type Effect = typeof Effect.Type

export const Info = Schema.Struct({
  action: Schema.Literal("provider.use"),
  resource: Schema.String,
  effect: Effect,
})
export type Info = typeof Info.Type
