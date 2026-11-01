export * as Job from "./job.js"

import { Schema } from "effect"
import { optional } from "./schema.js"
import { SessionID } from "./session-id.js"

export const Kind = Schema.Literals(["shell", "subagent", "image"]).annotate({ identifier: "Job.Kind" })
export type Kind = typeof Kind.Type

export const Status = Schema.Literals(["running", "completed", "error", "cancelled"]).annotate({
  identifier: "Job.Status",
})
export type Status = typeof Status.Type

export interface Time extends Schema.Schema.Type<typeof Time> {}
export const Time = Schema.Struct({
  started: Schema.Finite.annotate({ description: "Start time in milliseconds since the Unix epoch" }),
  completed: optional(Schema.Finite).annotate({
    description: "Completion time in milliseconds since the Unix epoch",
  }),
}).annotate({ identifier: "Job.Time" })

const Base = {
  id: Schema.String,
  sessionID: SessionID,
  status: Status,
  title: optional(Schema.String),
  time: Time,
}

export interface Shell extends Schema.Schema.Type<typeof Shell> {}
export const Shell = Schema.Struct({
  kind: Schema.tag("shell"),
  ...Base,
  shellID: Schema.String,
  command: Schema.String,
}).annotate({ identifier: "Job.Shell" })

export interface Subagent extends Schema.Schema.Type<typeof Subagent> {}
export const Subagent = Schema.Struct({
  kind: Schema.tag("subagent"),
  ...Base,
  childSessionID: SessionID,
  agent: Schema.String,
  description: Schema.String,
}).annotate({ identifier: "Job.Subagent" })

export interface Image extends Schema.Schema.Type<typeof Image> {}
export const Image = Schema.Struct({
  kind: Schema.tag("image"),
  ...Base,
  path: Schema.String,
  model: Schema.String,
}).annotate({ identifier: "Job.Image" })

export const Info = Schema.Union([Shell, Subagent, Image]).pipe(
  Schema.toTaggedUnion("kind"),
  Schema.annotate({ identifier: "Job.Info" }),
)
export type Info = typeof Info.Type
