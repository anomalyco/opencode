export * as MessageOrigin from "./message-origin.js"

import { Schema } from "effect"

/** The user-message metadata key that holds a {@link MessageOrigin.Info}. */
export const Key = "opencode.origin"

/**
 * A `scheme:id` reference such as `session:ses_…` or `voice:ios`, or a bare scheme such as `seer`. Any sender picks
 * its own scheme. One trimmed line, so the line the agent reads can't be broken out of.
 */
export const Value = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(200),
  Schema.isTrimmed(),
  Schema.isPattern(/^[^\p{Cc}\u2028\u2029]+$/u),
).annotate({ identifier: "MessageOrigin.Value" })

// `actor` names whoever sent it when that isn't the person who owns the session.
const actor = Schema.optionalKey(Value)

export interface From extends Schema.Schema.Type<typeof From> {}
/** A machine sent the message: another session, a schedule, a tool. */
export const From = Schema.Struct({
  from: Value,
  via: Schema.optionalKey(Schema.Never),
  actor,
}).annotate({ identifier: "MessageOrigin.From" })

export interface Via extends Schema.Schema.Type<typeof Via> {}
/** The person sent the message through another surface: a voice call, a slash command, an app. */
export const Via = Schema.Struct({
  via: Value,
  from: Schema.optionalKey(Schema.Never),
  actor,
}).annotate({ identifier: "MessageOrigin.Via" })

/** Who sent a user message other than the person typing it in the session. `from` and `via` never appear together. */
export const Info = Schema.Union([From, Via]).annotate({ identifier: "MessageOrigin" })
export type Info = From | Via

/** User-message metadata whose {@link Key} entry, when present, is a valid origin. */
export const Metadata = Schema.StructWithRest(Schema.Struct({ [Key]: Schema.optionalKey(Info) }), [
  Schema.Record(Schema.String, Schema.Unknown),
]).annotate({ identifier: "MessageOrigin.Metadata" })
export type Metadata = typeof Metadata.Type
