export * as SessionErrors from "./error.js"

import { Schema } from "effect"
import { Agent } from "@opencode-ai/schema/agent"
import { SessionMessage } from "./message.js"
import { SessionSchema } from "./schema.js"
import { SessionError } from "@opencode-ai/schema/session-error"

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Session.NotFoundError", {
  sessionID: SessionSchema.ID,
}) {}

export class ForkEmptyError extends Schema.TaggedError<ForkEmptyError>()("Session.ForkEmptyError", {
  sessionID: SessionSchema.ID,
}) {
  override get message() {
    return `Cannot fork empty session: ${this.sessionID}`
  }
}

export class MessageDecodeError extends Schema.TaggedError<MessageDecodeError>()("Session.MessageDecodeError", {
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
}) {
  override get message() {
    return `Failed to decode message ${this.messageID} in session ${this.sessionID}`
  }
}

export class AgentNotFoundError extends Schema.TaggedError<AgentNotFoundError>()("Session.AgentNotFoundError", {
  sessionID: SessionSchema.ID,
  agent: Agent.ID,
}) {
  override get message() {
    return `Agent not found: "${this.agent}"`
  }
}

export class StepFailedError extends Schema.TaggedError<StepFailedError>()("Session.StepFailedError", {
  error: SessionError.Error,
}) {
  override get message() {
    return this.error.message
  }
}

export class UserInterruptedError extends Schema.TaggedError<UserInterruptedError>()(
  "Session.UserInterruptedError",
  {},
) {
  override get message() {
    return "Session interrupted by user"
  }
}
