export * as BlobStore from "./blob-store.js"

import { Schema } from "effect"
import { descending } from "./identifier.js"
import { statics } from "./schema.js"
import { SessionID } from "./session-id.js"

// Strict, because the server names files after it.
export const ID = Schema.String.check(Schema.isPattern(/^blob_[0-9a-f]{12}[0-9A-Za-z]{14}$/u)).pipe(
  Schema.brand("Blob.ID"),
  Schema.annotate({
    identifier: "Blob.ID",
    description: "A stored blob, such as a generated video or an uploaded image",
  }),
  statics((schema) => ({
    create: () => schema.make("blob_" + descending()),
  })),
)
export type ID = typeof ID.Type

/** Client-owned annotations, opaque to the server. The server takes at most {@link METADATA_LIMIT} bytes of it as JSON. */
export const Metadata = Schema.Record(Schema.String, Schema.Json).annotate({ identifier: "Blob.Metadata" })
export type Metadata = typeof Metadata.Type
export const METADATA_LIMIT = 4096

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  sessionID: Schema.optional(SessionID).annotate({
    description: "The session the blob was made in. A label only: deleting the session keeps the blob.",
  }),
  mime: Schema.String,
  bytes: Schema.Finite,
  name: Schema.optional(Schema.String),
  metadata: Schema.optional(Metadata),
  width: Schema.optional(Schema.Finite).annotate({
    description: "Display width in pixels of an image or video, read from the bytes when stored",
  }),
  height: Schema.optional(Schema.Finite).annotate({
    description: "Display height in pixels of an image or video, read from the bytes when stored",
  }),
  durationMs: Schema.optional(Schema.Finite).annotate({
    description: "Length of a video in milliseconds, read from the bytes when stored",
  }),
  time: Schema.Struct({ created: Schema.Finite, updated: Schema.Finite }),
}).annotate({ identifier: "Blob.Info" })
