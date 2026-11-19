export * as SessionAttention from "./session-attention.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { Form } from "./form.js"
import { Permission } from "./permission.js"
import { optional } from "./schema.js"
import { SessionID } from "./session-id.js"
import { SessionMessage } from "./session-message.js"

/** A pending permission request. Answer it with `session.permission.reply`. */
export const PermissionEntry = Schema.Struct({
  type: Schema.Literal("permission"),
  sessionID: SessionID,
  requestID: Permission.ID,
  /** The assistant message whose tool call asked, when the request came from a tool. */
  messageID: SessionMessage.ID.pipe(optional),
}).annotate({ identifier: "SessionAttention.Permission" })
export interface PermissionEntry extends Schema.Schema.Type<typeof PermissionEntry> {}

/** A pending form, such as the question tool's. Answer it with `session.form.reply`. */
export const QuestionEntry = Schema.Struct({
  type: Schema.Literal("question"),
  sessionID: SessionID,
  requestID: Form.ID,
  /** The assistant message whose tool call asked, when the form came from a tool. */
  messageID: SessionMessage.ID.pipe(optional),
}).annotate({ identifier: "SessionAttention.Question" })
export interface QuestionEntry extends Schema.Schema.Type<typeof QuestionEntry> {}

/** What a plugin's `experimental.attention` hook reports about a finished response. */
export const PluginInput = Schema.Struct({
  reason: Schema.String,
}).annotate({ identifier: "SessionAttention.PluginInput" })
export interface PluginInput extends Schema.Schema.Type<typeof PluginInput> {}

/** Attention a plugin set for the Session's last finished response. */
export const PluginEntry = Schema.Struct({
  type: Schema.Literal("plugin"),
  sessionID: SessionID,
  /** The finished assistant message the plugin looked at. */
  messageID: SessionMessage.ID,
  reason: PluginInput.fields.reason,
}).annotate({ identifier: "SessionAttention.Plugin" })
export interface PluginEntry extends Schema.Schema.Type<typeof PluginEntry> {}

export const Entry = Schema.Union([PermissionEntry, QuestionEntry, PluginEntry])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "SessionAttention.Entry" })
export type Entry = typeof Entry.Type

/**
 * Plugin attention for a Session changed. `attention` is the Session's complete plugin attention; pending permissions
 * and forms keep their own `permission.*` and `form.*` events.
 */
const Updated = ephemeral({
  type: "session.attention.updated",
  schema: { sessionID: SessionID, attention: Schema.Array(PluginEntry) },
})

export const Event = { Updated, Definitions: inventory(Updated) }
