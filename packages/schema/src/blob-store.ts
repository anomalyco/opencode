export * as BlobStore from "./blob-store.js"

import { Schema } from "effect"

/**
 * The ID of what made the blob and the blob's position among its outputs: `video_<id>_0` is a video job's first
 * video. The prefix says what kind of blob it is. Strict, because the server names files after it.
 */
export const ID = Schema.String.check(
  Schema.isPattern(/^video_[0-9a-f]{12}[0-9A-Za-z]{14}_(0|[1-9][0-9]{0,2})$/u),
).pipe(Schema.brand("Blob.ID"), Schema.annotate({ identifier: "Blob.ID" }))
export type ID = typeof ID.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  mime: Schema.String,
  bytes: Schema.Finite,
  expiresAt: Schema.Finite.annotate({
    description: "Epoch milliseconds after which the blob may be deleted. Read it with GET /api/experimental/blob/:id",
  }),
}).annotate({ identifier: "Blob.Info" })
