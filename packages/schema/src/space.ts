export * as Space from "./space.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { NonNegativeInt } from "./schema.js"

export const Name = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._-]{1,128}$/u)).annotate({
  identifier: "Space.Name",
  description: "Client-chosen namespace: 1-128 letters, digits, '.', '_' or '-'.",
})
export type Name = typeof Name.Type

export const Key = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)).annotate({
  identifier: "Space.Key",
})
export type Key = typeof Key.Type

/** Any JSON but a top-level null, which the store cannot hold. */
export const Value = Schema.Union([
  Schema.String,
  Schema.Finite,
  Schema.Boolean,
  Schema.Array(Schema.Json),
  Schema.Record(Schema.String, Schema.Json),
]).annotate({ identifier: "Space.Value" })
export type Value = typeof Value.Type

/** A value always goes out as one event, so a write is capped at 1 MiB of JSON. */
export const MaxValueBytes = 1024 * 1024

export interface Entry extends Schema.Schema.Type<typeof Entry> {}
export const Entry = Schema.Struct({ key: Key, value: Value }).annotate({ identifier: "Space.Entry" })

/** Server-issued, per space: every write in a space gets the next revision, and revisions are never reused. */
export const Revision = NonNegativeInt.annotate({ identifier: "Space.Revision" })
export type Revision = typeof Revision.Type

/** A space to subscribe to, optionally followed by `:`, the epoch, `.` and the last revision the client applied. */
export const Subscription = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._-]{1,128}(:.*)?$/u)).annotate({
  identifier: "Space.Subscription",
})

/** Identifies the database that issued a space's revisions; a revision is only usable with the same epoch. */
export const Epoch = Schema.String.annotate({ identifier: "Space.Epoch" })

/**
 * The first batch of a space's entries, sent when a stream opens without a usable revision for it: the client drops
 * what it held for the space. Later batches arrive as deltas. Never published on the bus.
 */
const Snapshot = ephemeral({
  type: "experimental.kv.snapshot",
  schema: { space: Name, epoch: Epoch, revision: Revision, entries: Schema.Array(Entry) },
})
/**
 * Final values of the keys changed after the previous revision, and the keys deleted since, in batches. Each batch
 * covers every change up to its revision. Never published on the bus.
 */
const Delta = ephemeral({
  type: "experimental.kv.delta",
  schema: { space: Name, epoch: Epoch, revision: Revision, entries: Schema.Array(Entry), deleted: Schema.Array(Key) },
})
const Updated = ephemeral({
  type: "experimental.kv.updated",
  schema: { space: Name, key: Key, value: Value, revision: Revision },
})
const Deleted = ephemeral({
  type: "experimental.kv.deleted",
  schema: { space: Name, key: Key, revision: Revision },
})
export const Event = {
  Snapshot,
  Delta,
  Updated,
  Deleted,
  Definitions: inventory(Snapshot, Delta, Updated, Deleted),
}
