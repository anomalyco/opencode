import { Schema } from "effect"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionError } from "@opencode-ai/schema/session-error"

export class MessageDecodeError extends Schema.TaggedErrorClass<MessageDecodeError>()("Session.MessageDecodeError", {
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
}) {
  override get message() {
    return `Failed to decode message ${this.messageID} in session ${this.sessionID}`
  }
}

export class StepFailedError extends Schema.TaggedErrorClass<StepFailedError>()("Session.StepFailedError", {
  error: SessionError.Error,
}) {
  override get message() {
    return this.error.message
  }
}

export class UserInterruptedError extends Schema.TaggedErrorClass<UserInterruptedError>()(
  "Session.UserInterruptedError",
  {},
) {
  override get message() {
    return "Session interrupted by user"
  }
}
