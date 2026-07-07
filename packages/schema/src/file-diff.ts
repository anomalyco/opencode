export * as FileDiff from "./file-diff.js"

import { Schema } from "effect"
import { NonNegativeInt } from "./schema.js"

export const Info = Schema.Struct({
  file: Schema.String,
  patch: Schema.String,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  status: Schema.Literals(["added", "deleted", "modified"]),
}).annotate({ identifier: "FileDiff.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
