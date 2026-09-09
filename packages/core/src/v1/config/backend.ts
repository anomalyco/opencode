export * as ConfigBackendV1 from "./backend"

import { Schema } from "effect"
import { PositiveInt } from "../../schema"

export const Model = Schema.Struct({
  key: Schema.NonEmptyString,
  name: Schema.optional(Schema.NonEmptyString),
}).annotate({
  description: "A DSH provider/model route exposed by OpenCode's model selector.",
})

export type Model = Schema.Schema.Type<typeof Model>

export const DSH = Schema.Struct({
  type: Schema.Literal("dsh"),
  command: Schema.mutable(Schema.Array(Schema.String.check(Schema.isMinLength(1)))).check(Schema.isMinLength(1)),
  models: Schema.optional(Schema.mutable(Schema.Array(Model))),
  default_model: Schema.optional(Schema.NonEmptyString),
  startup_timeout: Schema.optional(PositiveInt),
  shutdown_timeout: Schema.optional(PositiveInt),
}).annotate({
  description:
    "Run DeepSeek Harness as an owned ACP stdio process. Command is an executable followed by arguments, without shell expansion. Models are provider/model route keys offered by OpenCode's selector; DSH validates the selected route. Timeouts are milliseconds (defaults: 30000 startup, 5000 shutdown). DSH owns model configuration and credentials.",
})

export type DSH = Schema.Schema.Type<typeof DSH>
export const Info = Schema.Union([Schema.Struct({ type: Schema.Literal("native") }), DSH])
export type Info = Schema.Schema.Type<typeof Info>
