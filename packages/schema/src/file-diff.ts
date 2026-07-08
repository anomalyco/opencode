export * as FileDiff from "./file-diff.js"

import { Schema } from "effect"
import { NonNegativeInt, optional } from "./schema.js"

export const Info = Schema.Struct({
  file: Schema.String,
  patch: Schema.String,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  status: Schema.Literals(["added", "deleted", "modified"]),
}).annotate({ identifier: "FileDiff.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

/** V1 snapshot and persisted session diff shape. */
export const LegacyInfo = Schema.Struct({
  file: Schema.String.pipe(optional),
  patch: Schema.String.pipe(optional),
  additions: Schema.Finite,
  deletions: Schema.Finite,
  status: Schema.Literals(["added", "deleted", "modified"]).pipe(optional),
}).annotate({ identifier: "FileDiff.LegacyInfo" })
export interface LegacyInfo extends Schema.Schema.Type<typeof LegacyInfo> {}
