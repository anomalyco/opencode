export * as Job from "./job.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { NonNegativeInt, optional } from "./schema.js"
import { SessionID } from "./session-id.js"

export const Status = Schema.Literals(["running", "completed", "error", "cancelled"]).annotate({
  identifier: "Job.Status",
})
export type Status = typeof Status.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: Schema.String,
  sessionID: optional(SessionID),
  type: Schema.String,
  title: optional(Schema.String),
  status: Status,
  started_at: NonNegativeInt,
  completed_at: optional(NonNegativeInt),
  output: optional(Schema.String),
  error: optional(Schema.String),
  metadata: optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "Job.Info" })

const Updated = ephemeral({
  type: "job.updated",
  schema: {
    info: Info,
    active: Schema.Boolean,
  },
})

export const Event = { Updated, Definitions: inventory(Updated) }
