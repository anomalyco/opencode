export * as Attachment from "./attachment"

import { Schema } from "effect"
import { ascending } from "./identifier"
import { NonNegativeInt, statics } from "./schema"

export const MAX_FILE_BYTES = 25 * 1024 * 1024

export const ID = Schema.String.check(Schema.isPattern(/^att_[0-9A-Za-z]+$/)).pipe(
  Schema.brand("Attachment.ID"),
  statics((schema) => ({ create: () => schema.make("att_" + ascending()) })),
)
export type ID = typeof ID.Type

export const URI = Schema.String.check(Schema.isPattern(/^opencode:\/\/attachment\/att_[0-9A-Za-z]+$/)).pipe(
  Schema.brand("Attachment.URI"),
  statics((schema) => ({
    fromID: (id: ID) => schema.make(`opencode://attachment/${id}`),
  })),
)
export type URI = typeof URI.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  uri: URI,
  name: Schema.String,
  mime: Schema.String,
  size: NonNegativeInt,
}).annotate({ identifier: "Attachment.Info" })
