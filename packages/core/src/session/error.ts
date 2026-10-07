import { Schema } from "effect"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"

export class MessageDecodeError extends Schema.TaggedErrorClass<MessageDecodeError>()("Session.MessageDecodeError", {
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
}) {
  override get message() {
    return `Failed to decode message ${this.messageID} in session ${this.sessionID}`
  }
}

export class ContextSnapshotDecodeError extends Schema.TaggedErrorClass<ContextSnapshotDecodeError>()(
  "Session.ContextSnapshotDecodeError",
  {
    sessionID: SessionSchema.ID,
    details: Schema.String,
  },
) {
  override get message() {
    return `Failed to decode context snapshot for session ${this.sessionID}: ${this.details}`
  }
}

/**
 * Raised by the Phase 11 HumanEscalation watchdog when a single Session drain
 * exceeds {@link RecoveryLimits.maxExecutionTime}. A drain that never goes idle
 * (e.g. a provider turn that hangs without emitting a retryable error, or an
 * otherwise stuck tool loop) surfaces this error instead of running forever.
 */
export class SessionTimeoutError extends Schema.TaggedErrorClass<SessionTimeoutError>()("Session.Timeout", {
  sessionID: SessionSchema.ID,
  elapsed: Schema.Number,
}) {
  override get message() {
    return `Session exceeded the max execution time (${this.elapsed}ms)`
  }
}

/**
 * Raised when a single Session drain records {@link RecoveryLimits.maxToolFailures}
 * consecutive tool failures without an intervening success. A model stuck
 * retrying a failing tool surfaces this error instead of looping turns forever.
 */
export class SessionToolBudgetError extends Schema.TaggedErrorClass<SessionToolBudgetError>()("Session.ToolBudget", {
  sessionID: SessionSchema.ID,
  failures: Schema.Number,
  limit: Schema.Number,
}) {
  override get message() {
    return `Session exceeded the max consecutive tool failures (${this.failures}/${this.limit})`
  }
}
