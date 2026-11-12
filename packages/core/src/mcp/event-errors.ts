import { Schema } from "effect"

/**
 * The server refused the subscription, as for an unknown event type, bad arguments or missing access.
 * Experimental: MCP Events is a draft extension; may change without compatibility guarantees.
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
 * Experimental: MCP Events is a draft extension; may change without compatibility guarantees.
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
