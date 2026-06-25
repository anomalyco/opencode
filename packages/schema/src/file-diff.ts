export * as FileDiff from "./file-diff"

import { Schema } from "effect"

export const Info = Schema.Struct({
  file: Schema.optional(Schema.String),
  patch: Schema.optional(Schema.String),
  additions: Schema.Finite,
  deletions: Schema.Finite,
  status: Schema.optional(Schema.Literals(["added", "deleted", "modified"])),
}).annotate({ identifier: "SnapshotFileDiff" })
export type Info = typeof Info.Type
