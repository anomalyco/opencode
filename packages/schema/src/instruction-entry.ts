export * as InstructionEntry from "./instruction-entry.js"

import { Schema } from "effect"

export const MaxKeyLength = 128
const StoredKey = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]*$/u))

/**
 * Slash-free client-facing key for one API-managed instruction entry. The server
 * derives the namespaced Instructions key as `api/<key>`, keeping the
 * `api/*` namespace enforced by construction.
 */
export const Key = StoredKey.check(Schema.isMaxLength(MaxKeyLength)).annotate({
  identifier: "InstructionEntry.Key",
  description: "Instruction entry key (lowercase alphanumerics plus . _ -)",
})
export type Key = typeof Key.Type

export const Info = Schema.Struct({
  key: Key,
  value: Schema.Json.annotate({ description: "JSON value attached to the session's instructions" }),
}).annotate({ identifier: "InstructionEntry.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const Snapshot = Schema.Array(
  Schema.Struct({
    ...Info.fields,
    // Durable fork events predate the mutation key-length limit and must remain replayable.
    key: StoredKey,
    removed: Schema.Boolean,
  }),
).annotate({ identifier: "InstructionEntry.Snapshot" })
export type Snapshot = typeof Snapshot.Type

export const MaxValueBytes = 256 * 1024

export class InvalidKeyError extends Schema.TaggedError<InvalidKeyError>()(
  "InstructionEntryInvalidKeyError",
  {
    key: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

export class ValueTooLargeError extends Schema.TaggedError<ValueTooLargeError>()(
  "InstructionEntryValueTooLargeError",
  {
    actualBytes: Schema.Int,
    maxBytes: Schema.Int,
    message: Schema.String,
  },
  { httpApiStatus: 413 },
) {}
