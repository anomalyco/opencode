export * as PersistentPty from "./persistent-pty.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { Pty } from "./pty.js"
import { NonNegativeInt, PositiveInt, optional } from "./schema.js"
import { Session } from "./session.js"

export const Info = Schema.Struct({
  ...Pty.Info.fields,
  sessionID: Session.ID,
  foregroundProcess: Schema.NullOr(Schema.String),
  size: Schema.Struct({ cols: PositiveInt, rows: PositiveInt }),
  output: Schema.Struct({ head: NonNegativeInt, tail: NonNegativeInt }),
}).annotate({ identifier: "PersistentPty.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const Handoff = Schema.Struct({
  directory: Schema.String,
  instanceID: Schema.String,
  ticket: Schema.String,
  expiresAt: Schema.Number,
}).annotate({ identifier: "PersistentPty.Handoff" })
export interface Handoff extends Schema.Schema.Type<typeof Handoff> {}

export const CreateInput = Schema.Struct({
  command: optional(Schema.String),
  args: Schema.Array(Schema.String),
  cwd: optional(Schema.String),
  title: Schema.String,
  env: Schema.Record(Schema.String, Schema.String),
  size: optional(Schema.Struct({ cols: PositiveInt, rows: PositiveInt })),
}).annotate({ identifier: "PersistentPty.CreateInput" })
export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}

export const UpdateInput = Schema.Struct({
  attachmentID: optional(Schema.String),
  size: Schema.Struct({ cols: PositiveInt, rows: PositiveInt }),
}).annotate({ identifier: "PersistentPty.UpdateInput" })
export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}

export const Snapshot = Schema.Struct({
  info: Info,
  text: Schema.String,
  checkpoint: Schema.Uint8Array,
  cursor: Schema.Struct({ x: NonNegativeInt, y: NonNegativeInt }),
}).annotate({ identifier: "PersistentPty.Snapshot" })
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}

export const ReadLines = PositiveInt.check(Schema.isLessThanOrEqualTo(65535)).annotate({
  identifier: "PersistentPty.ReadLines",
})

export const ReadResult = Schema.Struct({
  ptyID: Pty.ID,
  title: Schema.String,
  cwd: Schema.String,
  foregroundProcess: Schema.NullOr(Schema.String),
  screen: Schema.Struct({
    text: Schema.String,
    cols: PositiveInt,
    rows: PositiveInt,
    cursor: Snapshot.fields.cursor,
  }),
}).annotate({ identifier: "PersistentPty.ReadResult" })
export interface ReadResult extends Schema.Schema.Type<typeof ReadResult> {}

export const Added = ephemeral({ type: "persistent-pty.added", schema: { sessionID: Session.ID, terminal: Info } })
export const Removed = ephemeral({ type: "persistent-pty.removed", schema: { sessionID: Session.ID, ptyID: Pty.ID } })
export const Event = { Added, Removed, Definitions: inventory(Added, Removed) }
