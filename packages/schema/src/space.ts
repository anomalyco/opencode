export * as Space from "./space.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { NonNegativeInt, optional } from "./schema.js"

export const Name = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._-]{1,128}$/u)).annotate({
  identifier: "Space.Name",
  description: "Client-chosen namespace: 1-128 letters, digits, '.', '_' or '-'.",
})
export type Name = typeof Name.Type

export const Key = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)).annotate({
  identifier: "Space.Key",
})
export type Key = typeof Key.Type

/** An opaque string the server stores and sends back unchanged; its format, such as JSON text, is up to the client. */
export const Value = Schema.String.annotate({ identifier: "Space.Value" })
export type Value = typeof Value.Type

/** A value always goes out as one event, so a write's values are capped at 1 MiB of UTF-8 in total. */
export const MaxValueBytes = 1024 * 1024

export interface Entry extends Schema.Schema.Type<typeof Entry> {}
export const Entry = Schema.Struct({ key: Key, value: Value }).annotate({ identifier: "Space.Entry" })

/** One change of a write: a value sets the key, `null` deletes it. */
export interface Change extends Schema.Schema.Type<typeof Change> {}
export const Change = Schema.Struct({ key: Key, value: Schema.NullOr(Value) }).annotate({
  identifier: "Space.Change",
})

/** Changes one write commits at most. */
export const MaxChanges = 1024

/** Server-issued, per space: every write in a space gets the next revision, and revisions are never reused. */
export const Revision = NonNegativeInt.annotate({ identifier: "Space.Revision" })
export type Revision = typeof Revision.Type

/** Identifies the database that issued a space's revisions; a revision is only usable with the same epoch. */
export const Epoch = Schema.String.annotate({ identifier: "Space.Epoch" })

/** An opaque position in a space, issued by the server. Clients save a page's `cursor` and pass back `next` as is. */
export const Cursor = Schema.String.annotate({ identifier: "Space.Cursor" })

const page = {
  space: Name,
  epoch: Epoch,
  revision: Revision,
  entries: Schema.Array(Entry),
  cursor: Cursor.annotate({ description: "Covers every change up to this page; save it to subscribe or sync from." }),
  next: optional(Cursor).annotate({ description: "Present while more pages remain: sync again with it as `cursor`." }),
}

/** A sync page that replaces everything the client held for the space. */
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}
export const Snapshot = Schema.Struct({ type: Schema.tag("snapshot"), ...page }).annotate({
  identifier: "Space.Snapshot",
})

/** A sync page with the final values of the keys changed after the previous page, and the keys deleted since. */
export interface Delta extends Schema.Schema.Type<typeof Delta> {}
export const Delta = Schema.Struct({ type: Schema.tag("delta"), ...page, deleted: Schema.Array(Key) }).annotate({
  identifier: "Space.Delta",
})

export const Page = Schema.Union([Snapshot, Delta]).pipe(
  Schema.toTaggedUnion("type"),
  Schema.annotate({ identifier: "Space.Page" }),
)
export type Page = typeof Page.Type

/** Sent instead of the changes when they no longer fit one batch or the cursor is unusable: sync and subscribe again. */
const Resync = ephemeral({ type: "experimental.space.resync", schema: { space: Name } })
const Updated = ephemeral({
  type: "experimental.space.updated",
  schema: { space: Name, key: Key, value: Value, revision: Revision },
})
const Deleted = ephemeral({
  type: "experimental.space.deleted",
  schema: { space: Name, key: Key, revision: Revision },
})
export const Event = {
  Resync,
  Updated,
  Deleted,
  Definitions: inventory(Resync, Updated, Deleted),
}
