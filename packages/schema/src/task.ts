export * as Task from "./task"

import { Schema } from "effect"
import { optional, statics } from "./schema"
import { ascending } from "./identifier"

export const ID = Schema.String.pipe(
  Schema.brand("Task.ID"),
  statics((schema) => ({ create: () => schema.make("task_" + ascending()) })),
)
export type ID = typeof ID.Type

export const Status = Schema.Union([
  Schema.Literal("running"),
  Schema.Literal("stopped"),
  Schema.Literal("failed"),
  Schema.Literal("completed"),
]).annotate({ identifier: "Task.Status" })
export type Status = typeof Status.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  name: Schema.String,
  command: Schema.String,
  cwd: Schema.String,
  status: Status,
  pid: optional(Schema.Number),
  port: optional(Schema.Number),
  exitCode: optional(Schema.Number),
  error: optional(Schema.String),
  startedAt: Schema.Number,
  completedAt: optional(Schema.Number),
  metadata: optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "Task.Info" })
