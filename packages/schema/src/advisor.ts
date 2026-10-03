export * as Advisor from "./advisor"

import { Schema } from "effect"
import { optional, PositiveInt } from "./schema"

const Model = Schema.String.check(Schema.isPattern(/^\S+$/))

export interface Settings extends Schema.Schema.Type<typeof Settings> {}
export const Settings = Schema.Struct({ model: Model, maxUses: PositiveInt }).annotate({
  identifier: "Advisor.Settings",
})

export const Input = Schema.Union([
  Schema.Literal(false),
  Schema.Struct({ model: Model.pipe(optional), maxUses: PositiveInt.pipe(optional) }),
]).annotate({ identifier: "Advisor.Input" })
export type Input = typeof Input.Type
