export * as ClientKV from "./client-kv.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { NonNegativeInt } from "./schema.js"

export const Space = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._-]{1,128}$/u)).annotate({
  identifier: "ClientKV.Space",
  description: "Client-chosen namespace: 1-128 letters, digits, '.', '_' or '-'.",
})
export type Space = typeof Space.Type

export const Key = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)).annotate({
  identifier: "ClientKV.Key",
})
export type Key = typeof Key.Type

/** Any JSON but a top-level null, which the store cannot hold. */
export const Value = Schema.Union([
  Schema.String,
  Schema.Finite,
  Schema.Boolean,
  Schema.Array(Schema.Json),
  Schema.Record(Schema.String, Schema.Json),
]).annotate({ identifier: "ClientKV.Value" })
export type Value = typeof Value.Type

export interface Entry extends Schema.Schema.Type<typeof Entry> {}
export const Entry = Schema.Struct({ key: Key, value: Value }).annotate({ identifier: "ClientKV.Entry" })

/** Server-issued, per space: every write in a space gets the next revision, and revisions are never reused. */
export const Revision = NonNegativeInt.annotate({ identifier: "ClientKV.Revision" })
export type Revision = typeof Revision.Type

/** A space to subscribe to, optionally followed by `:` and the last revision the client applied. */
export const Subscription = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._-]{1,128}(:.*)?$/u)).annotate({
  identifier: "ClientKV.Subscription",
})

/** Every entry of a space, sent when a stream opens without a usable revision for it. Never published on the bus. */
const Snapshot = ephemeral({
  type: "experimental.kv.snapshot",
  schema: { space: Space, revision: Revision, entries: Schema.Array(Entry) },
})
/** Final values of the keys changed after the requested revision, and the keys deleted since. Never published on the bus. */
const Delta = ephemeral({
  type: "experimental.kv.delta",
  schema: { space: Space, revision: Revision, entries: Schema.Array(Entry), deleted: Schema.Array(Key) },
})
const Updated = ephemeral({
  type: "experimental.kv.updated",
  schema: { space: Space, key: Key, value: Value, revision: Revision },
})
const Deleted = ephemeral({
  type: "experimental.kv.deleted",
  schema: { space: Space, key: Key, revision: Revision },
})
export const Event = {
  Snapshot,
  Delta,
  Updated,
  Deleted,
  Definitions: inventory(Snapshot, Delta, Updated, Deleted),
}
