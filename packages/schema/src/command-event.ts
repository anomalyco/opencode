export * as CommandEvent from "./command-event"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { ascending } from "./identifier"
import { NonNegativeInt } from "./schema"

export const ID = Schema.String.pipe(
  Schema.check(Schema.isStartsWith("cmd_")),
  Schema.brand("CommandSessionID"),
)
export type ID = string

export const Status = Schema.Literals([
  "starting",
  "running",
  "waiting_for_input",
  "exited",
  "failed",
  "terminated",
  "timed_out",
  "lost",
])
export type Status = "starting" | "running" | "waiting_for_input" | "exited" | "failed" | "terminated" | "timed_out" | "lost"

export const Info = Schema.Struct({
  id: ID,
  command: Schema.String,
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
  pid: NonNegativeInt,
  status: Status,
  exitCode: Schema.Union([NonNegativeInt, Schema.Null]),
  signal: Schema.Union([Schema.String, Schema.Null]),
  startedAt: Schema.String,
  runtimeMs: NonNegativeInt,
  idleMs: NonNegativeInt,
  outputTruncated: Schema.Boolean.pipe(Schema.optional),
  omittedBytes: NonNegativeInt.pipe(Schema.optional),
})
export type Info = typeof Info.Type

const Created = define({ type: "command.started", schema: { info: Info } })
const Updated = define({ type: "command.updated", schema: { info: Info } })
const OutputDelta = define({ type: "command.output_delta", schema: { sessionId: ID, stdout: Schema.String.pipe(Schema.optional), stderr: Schema.String.pipe(Schema.optional) } })
const Exited = define({ type: "command.exited", schema: { id: ID, exitCode: NonNegativeInt, signal: Schema.String.pipe(Schema.optional) } })
const Terminated = define({ type: "command.terminated", schema: { id: ID } })
const TimedOut = define({ type: "command.timed_out", schema: { id: ID } })
const InterruptRequested = define({ type: "command.interrupt_requested", schema: { id: ID } })
const InputWritten = define({ type: "command.input_written", schema: { id: ID, bytes: NonNegativeInt } })
const OutputTruncated = define({ type: "command.output_truncated", schema: { id: ID, omittedBytes: NonNegativeInt } })
const Failed = define({ type: "command.failed", schema: { id: ID, error: Schema.String } })
const Deleted = define({ type: "command.deleted", schema: { id: ID } })

export const Event = {
  Created,
  Updated,
  OutputDelta,
  Exited,
  Terminated,
  TimedOut,
  InterruptRequested,
  InputWritten,
  OutputTruncated,
  Failed,
  Deleted,
  Definitions: inventory(Created, Updated, OutputDelta, Exited, Terminated, TimedOut, InterruptRequested, InputWritten, OutputTruncated, Failed, Deleted),
}
