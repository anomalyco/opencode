export * as ConfigError from "./error"

import { NamedError } from "@opencode-ai/core/util/error"
import { Schema } from "effect"

const Issue = Schema.StructWithRest(
  Schema.Struct({
    message: Schema.String,
    path: Schema.Array(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

export const JsonError = NamedError.create("ConfigJsonError", {
  path: Schema.String,
  message: Schema.optional(Schema.String),
})

export const InvalidError = NamedError.create("ConfigInvalidError", {
  path: Schema.String,
  issues: Schema.optional(Schema.Array(Issue)),
  message: Schema.optional(Schema.String),
})
