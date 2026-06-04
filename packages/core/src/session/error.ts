import { Schema } from "effect"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"

export class MessageDecodeError extends Schema.TaggedErrorClass<MessageDecodeError>()("Session.MessageDecodeError", {
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
}) {}
