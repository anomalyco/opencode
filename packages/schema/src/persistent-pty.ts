export * as PersistentPty from "./persistent-pty.js"

import { Schema } from "effect"
import { Group } from "./group.js"
import { Pty } from "./pty.js"
import { NonNegativeInt, PositiveInt, optional } from "./schema.js"

export const Info = Schema.Struct({
  ...Pty.Info.fields,
  groupID: Group.ID,
  size: Schema.Struct({ cols: PositiveInt, rows: PositiveInt }),
  output: Schema.Struct({ head: NonNegativeInt, tail: NonNegativeInt }),
}).annotate({ identifier: "PersistentPty.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const CreateInput = Schema.Struct({
  command: Schema.String,
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
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
