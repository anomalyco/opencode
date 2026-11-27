export * as BlobStore from "./blob-store.js"

import { Schema } from "effect"
import { descending } from "./identifier.js"
import { statics } from "./schema.js"

// Strict, because the server names files after it.
export const ID = Schema.String.check(Schema.isPattern(/^blob_[0-9a-f]{12}[0-9A-Za-z]{14}$/u)).pipe(
  Schema.brand("Blob.ID"),
  Schema.annotate({
    identifier: "Blob.ID",
    description: "A stored blob, such as a generated video, which outlives the job that made it",
  }),
  statics((schema) => ({
    create: () => schema.make("blob_" + descending()),
  })),
)
export type ID = typeof ID.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  mime: Schema.String,
  bytes: Schema.Finite,
}).annotate({ identifier: "Blob.Info" })
