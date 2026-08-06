export * as SessionErrors from "./error"

import { Schema } from "effect"
import { Agent } from "@opencode-ai/schema/agent"
import { WorkspaceID } from "@opencode-ai/schema/workspace-id"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionError } from "@opencode-ai/schema/session-error"

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Session.NotFoundError", {
  sessionID: SessionSchema.ID,
}) {}

export class ForkEmptyError extends Schema.TaggedErrorClass<ForkEmptyError>()("Session.ForkEmptyError", {
  sessionID: SessionSchema.ID,
}) {
  override get message() {
    return `Cannot fork empty session: ${this.sessionID}`
  }
}

export class WorkspaceDirectoryError extends Schema.TaggedErrorClass<WorkspaceDirectoryError>()(
  "Session.WorkspaceDirectoryError",
  {
    workspaceID: WorkspaceID,
    directory: Schema.String,
    root: Schema.String,
  },
) {
  override get message() {
    return `Directory ${this.directory} is outside workspace ${this.workspaceID} root ${this.root}`
  }
}

export class MessageDecodeError extends Schema.TaggedErrorClass<MessageDecodeError>()("Session.MessageDecodeError", {
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
}) {
  override get message() {
    return `Failed to decode message ${this.messageID} in session ${this.sessionID}`
  }
}

export class AgentNotFoundError extends Schema.TaggedErrorClass<AgentNotFoundError>()("Session.AgentNotFoundError", {
  sessionID: SessionSchema.ID,
  agent: Agent.ID,
}) {
  override get message() {
    return `Agent not found: "${this.agent}"`
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
