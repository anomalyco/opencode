export * as Pty from "./pty"

import { Schema } from "effect"
import { define } from "./event"
import { ascending } from "./identifier"
import { NonNegativeInt } from "./schema"
import { withStatics } from "./schema"

const IDSchema = Schema.String.check(Schema.isStartsWith("pty")).pipe(Schema.brand("PtyID"))

export const ID = IDSchema.pipe(
  withStatics((schema: typeof IDSchema) => ({
    ascending: (id?: string) => schema.make(id ?? "pty_" + ascending()),
  })),
)
export type ID = typeof ID.Type

export const Info = Schema.Struct({
  id: ID,
  title: Schema.String,
  command: Schema.String,
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
  status: Schema.Literals(["running", "exited"]),
  pid: NonNegativeInt,
  exitCode: Schema.optional(NonNegativeInt),
}).annotate({ identifier: "Pty" })
export const PtyInfo = Info

export const Event = {
  Created: define({ type: "pty.created", schema: { info: Info } }),
  Updated: define({ type: "pty.updated", schema: { info: Info } }),
  Exited: define({ type: "pty.exited", schema: { id: ID, exitCode: NonNegativeInt } }),
  Deleted: define({ type: "pty.deleted", schema: { id: ID } }),
}
export const PtyEvent = Event
