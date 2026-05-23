import { Schema } from "effect"
import { PositiveInt } from "@opencode-ai/core/schema"

export const Local = Schema.Struct({
  type: Schema.Literal("local").annotate({ description: "Type of ACP server connection" }),
  command: Schema.mutable(Schema.Array(Schema.String)).annotate({
    description: "Command and arguments to run the ACP server over stdio",
  }),
  environment: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Environment variables to set when running the ACP server",
  }),
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable or disable the ACP server",
  }),
  timeout: Schema.optional(PositiveInt).annotate({
    description: "Timeout in ms for ACP server requests. Defaults to 30000 (30 seconds) if not specified.",
  }),
}).annotate({ identifier: "AcpLocalConfig" })
export type Local = Schema.Schema.Type<typeof Local>

export const Info = Local.annotate({ discriminator: "type" })
export type Info = Schema.Schema.Type<typeof Info>

export * as ConfigACP from "./acp"
