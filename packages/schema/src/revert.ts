export * as Revert from "./revert"

import { Schema } from "effect"
import { NonNegativeInt, RelativePath } from "./schema"
import { SessionMessageID } from "./session-message-id"

export const FileDiff = Schema.Struct({
  path: RelativePath,
  status: Schema.Literals(["added", "modified", "deleted"]),
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  patch: Schema.String,
}).annotate({ identifier: "File.Diff" })
export type FileDiff = typeof FileDiff.Type

export const State = Schema.Struct({
  messageID: SessionMessageID.ID,
  partID: Schema.String.pipe(Schema.optional),
  snapshot: Schema.String.pipe(Schema.optional),
  diff: Schema.String.pipe(Schema.optional),
  files: Schema.Array(FileDiff).pipe(Schema.optional),
})
export type State = typeof State.Type
