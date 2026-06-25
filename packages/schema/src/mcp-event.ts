export * as McpEvent from "./mcp-event"

import { Schema } from "effect"
import { Event } from "./event"
import { ascending } from "./identifier"
import { statics } from "./schema"

export const ElicitationID = Schema.String.check(Schema.isStartsWith("mcpel")).pipe(
  Schema.brand("McpEvent.ElicitationID"),
  statics((schema) => ({ ascending: (id?: string) => schema.make(id ?? "mcpel_" + ascending()) })),
)
export type ElicitationID = typeof ElicitationID.Type

export const ElicitationBooleanProperty = Schema.Struct({
  type: Schema.Literal("boolean"),
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  default: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "McpEvent.ElicitationBooleanProperty" })
export type ElicitationBooleanProperty = typeof ElicitationBooleanProperty.Type

export const ElicitationBooleanSchema = Schema.Struct({
  $schema: Schema.optional(Schema.String),
  type: Schema.Literal("object"),
  properties: Schema.Record(Schema.String, ElicitationBooleanProperty),
  required: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "McpEvent.ElicitationBooleanSchema" })
export type ElicitationBooleanSchema = typeof ElicitationBooleanSchema.Type

export const ElicitationRequest = Schema.Struct({
  id: ElicitationID,
  server: Schema.String,
  message: Schema.String,
  schema: ElicitationBooleanSchema,
}).annotate({ identifier: "McpEvent.ElicitationRequest" })
export type ElicitationRequest = typeof ElicitationRequest.Type

export const ElicitationContent = Schema.Record(Schema.String, Schema.Boolean).annotate({
  identifier: "McpEvent.ElicitationContent",
})
export type ElicitationContent = typeof ElicitationContent.Type

export const ElicitationAccept = Schema.Struct({
  action: Schema.Literal("accept"),
  content: ElicitationContent,
}).annotate({ identifier: "McpEvent.ElicitationAccept" })
export const ElicitationDecline = Schema.Struct({
  action: Schema.Literal("decline"),
}).annotate({ identifier: "McpEvent.ElicitationDecline" })
export const ElicitationCancel = Schema.Struct({
  action: Schema.Literal("cancel"),
}).annotate({ identifier: "McpEvent.ElicitationCancel" })
export const ElicitationResult = Schema.Union([ElicitationAccept, ElicitationDecline, ElicitationCancel]).annotate({
  identifier: "McpEvent.ElicitationResult",
  discriminator: "action",
})
export type ElicitationResult = typeof ElicitationResult.Type

export const ToolsChanged = Event.define({
  type: "mcp.tools.changed",
  schema: {
    server: Schema.String,
  },
})

export const BrowserOpenFailed = Event.define({
  type: "mcp.browser.open.failed",
  schema: {
    mcpName: Schema.String,
    url: Schema.String,
  },
})

export const ElicitationAsked = Event.define({
  type: "mcp.elicitation.asked",
  schema: ElicitationRequest.fields,
})

export const ElicitationReplied = Event.define({
  type: "mcp.elicitation.replied",
  schema: {
    requestID: ElicitationID,
    result: ElicitationResult,
  },
})

export const Definitions = Event.inventory(ToolsChanged, BrowserOpenFailed, ElicitationAsked, ElicitationReplied)
