import { Schedule, Schema } from "effect"

// A dropped event stream or list-change listener reopens after a delay growing from a second to about 30 seconds,
// jittered so connections that broke together don't all reopen at the same moment.
export const reopen = Schedule.min([Schedule.exponential("1 second"), Schedule.spaced("30 seconds")]).pipe(
  Schedule.jittered,
)

/**
 * The server refused the subscription, as for an unknown event type, bad arguments or missing access.
 * Experimental: MCP Events is a beta extension; may change without compatibility guarantees.
 */
export class EventStreamRejectedError extends Schema.TaggedError<EventStreamRejectedError>()(
  "MCP.EventStreamRejectedError",
  {
    server: Schema.String,
    code: Schema.Number,
    message: Schema.String,
  },
) {}

/**
 * The server ended the subscription, as when access was revoked or the event type was removed or changed.
 * Experimental: MCP Events is a beta extension; may change without compatibility guarantees.
 */
export class EventStreamTerminatedError extends Schema.TaggedError<EventStreamTerminatedError>()(
  "MCP.EventStreamTerminatedError",
  {
    server: Schema.String,
    code: Schema.Number,
    message: Schema.String,
    data: Schema.optional(Schema.Json),
  },
) {}
