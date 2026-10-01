export * as Monitor from "./monitor.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { ascending } from "./identifier.js"
import { NonNegativeInt, optional, statics } from "./schema.js"
import { SessionID } from "./session-id.js"
import { SessionInbox } from "./session-inbox.js"
import { Shell } from "./shell.js"

export const ID = Schema.String.check(Schema.isStartsWith("mon_"))
  .pipe(Schema.brand("Monitor.ID"))
  .annotate({ identifier: "Monitor.ID" })
  .pipe(statics((schema) => ({ create: () => schema.make("mon_" + ascending()) })))
export type ID = typeof ID.Type

export const Status = Schema.Literals(["running", "ended"]).annotate({ identifier: "Monitor.Status" })
export type Status = typeof Status.Type

export const Reason = Schema.Literals([
  "exited",
  "expired",
  "cancelled",
  "rate_limit",
  "output_limit",
  "server_restarted",
  "error",
]).annotate({ identifier: "Monitor.Reason" })
export type Reason = typeof Reason.Type

export const Info = Schema.Struct({
  id: ID,
  sessionID: SessionID,
  shellID: Shell.ID,
  description: Schema.String,
  delivery: SessionInbox.Delivery,
  pid: optional(NonNegativeInt),
  log: Schema.String.annotate({ description: "Path of the shell log capturing stdout and stderr" }),
  startedAt: Schema.Finite.annotate({ description: "Start time in milliseconds since the Unix epoch" }),
  expiresAt: Schema.Finite.annotate({ description: "Deadline in milliseconds since the Unix epoch" }),
  endedAt: optional(Schema.Finite).annotate({ description: "End time in milliseconds since the Unix epoch" }),
  eventCount: NonNegativeInt,
  outputBytes: NonNegativeInt,
  status: Status,
  reason: optional(Reason),
  exitCode: optional(Schema.Finite),
}).annotate({ identifier: "Monitor.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const ENDED_LIMIT = 25

export function retain<
  T extends { readonly id: string; readonly status: Status; readonly startedAt: number; readonly endedAt?: number },
>(items: readonly T[]) {
  const ended = items
    .filter((item) => item.status === "ended")
    .toSorted((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt) || b.id.localeCompare(a.id))
    .slice(0, ENDED_LIMIT)
  return [...items.filter((item) => item.status === "running"), ...ended].toSorted(
    (a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id),
  )
}

const Started = ephemeral({ type: "monitor.started", schema: { info: Info } })
const Output = ephemeral({ type: "monitor.event", schema: { info: Info, lines: Schema.Array(Schema.String) } })
const Ended = ephemeral({ type: "monitor.ended", schema: { info: Info } })
export const Event = { Started, Output, Ended, Definitions: inventory(Started, Output, Ended) }
