export * as SessionTurn from "./session-turn.js"

import { Schema } from "effect"
import { SessionID } from "./session-id.js"
import { SessionMessage } from "./session-message.js"
import { SessionError } from "./session-error.js"
import { Money } from "./money.js"
import { TokenUsage } from "./token-usage.js"
import { optional } from "./schema.js"

const Base = {
  sessionID: SessionID,
  inputID: SessionMessage.ID,
}

const Turn = {
  turnID: SessionMessage.ID,
  inputIDs: Schema.Array(SessionMessage.ID),
  /** Assistant-step charges, including failed attempts. Title and compaction usage remain session overhead. */
  cost: Money.USD,
  tokens: TokenUsage.Info,
  /** Last assistant step in this turn; absent if execution failed before a step began. */
  assistantMessageID: SessionMessage.ID.pipe(optional),
}

/**
 * A turn begins when the first user or synthetic input is promoted. It contains all
 * model steps and steers promoted before the first boundary with no continuation
 * or eligible steer. The next queued input starts another turn, even inside the
 * same coordinator execution. All inputIDs share these totals; do not sum them.
 * Shutdown preserves an unfinished turn. "running" does not assert process ownership.
 */
export const Result = Schema.Union([
  Schema.Struct({ ...Turn, status: Schema.Literal("running") }),
  Schema.Struct({ ...Turn, status: Schema.Literal("settled") }),
  Schema.Struct({ ...Turn, status: Schema.Literal("failed"), error: SessionError.Error }),
  Schema.Struct({
    ...Turn,
    status: Schema.Literal("interrupted"),
    reason: Schema.Literals(["user", "superseded", "inactivity", "cancelled"]),
  }),
]).annotate({ identifier: "Session.Turn.Result" })
export type Result = typeof Result.Type

export const Info = Schema.Union([
  Schema.Struct({ ...Base, status: Schema.Literal("pending") }),
  Schema.Struct({ ...Base, ...Result.members[0].fields }),
  Schema.Struct({ ...Base, ...Result.members[1].fields }),
  Schema.Struct({ ...Base, ...Result.members[2].fields }),
  Schema.Struct({ ...Base, ...Result.members[3].fields }),
]).annotate({ identifier: "Session.Turn.Info" })
export type Info = typeof Info.Type
