export * as Revert from "./revert"

import { Schema } from "effect"
import { optional } from "./schema"
import { NonNegativeInt, RelativePath } from "./schema"
import { SessionMessage } from "./session-message"

export const FileDiff = Schema.Struct({
  path: RelativePath,
  status: Schema.Literals(["added", "modified", "deleted"]),
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  patch: Schema.String,
}).annotate({ identifier: "File.Diff" })
export interface FileDiff extends Schema.Schema.Type<typeof FileDiff> {}

export const State = Schema.Struct({
  messageID: SessionMessage.ID,
  partID: Schema.String.pipe(optional),
  snapshot: Schema.String.pipe(optional),
  diff: Schema.String.pipe(optional),
  files: Schema.Array(FileDiff).pipe(optional),
}).annotate({ identifier: "Revert.State" })
export interface State extends Schema.Schema.Type<typeof State> {}

export const PreviewItem = Schema.Struct({
  id: SessionMessage.ID,
  text: Schema.String,
}).annotate({ identifier: "Revert.Preview.Item" })
export interface PreviewItem extends Schema.Schema.Type<typeof PreviewItem> {}

export const Preview = Schema.Struct({
  messageID: SessionMessage.ID,
  userCount: NonNegativeInt,
  hasMore: Schema.Boolean,
  nextMessageID: SessionMessage.ID.pipe(optional),
  continuationMessageID: SessionMessage.ID.pipe(optional),
  items: Schema.Array(PreviewItem),
}).annotate({ identifier: "Revert.Preview" })
export interface Preview extends Schema.Schema.Type<typeof Preview> {}
