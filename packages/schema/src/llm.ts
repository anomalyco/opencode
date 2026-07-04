export * as LLM from "./llm.js"

import { Schema } from "effect"
import { optional } from "./schema.js"

export const ProviderMetadata = Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown)).annotate({
  identifier: "LLM.ProviderMetadata",
})
export type ProviderMetadata = Schema.Schema.Type<typeof ProviderMetadata>

export const FinishReason = Schema.Literals(["stop", "length", "tool-calls", "content-filter", "error", "unknown"])
export type FinishReason = typeof FinishReason.Type

export interface ToolTextContent extends Schema.Schema.Type<typeof ToolTextContent> {}
export const ToolTextContent = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
}).annotate({ identifier: "Tool.TextContent" })

export interface ToolFileContent extends Schema.Schema.Type<typeof ToolFileContent> {}
export const ToolFileContent = Schema.Struct({
  type: Schema.Literal("file"),
  uri: Schema.String,
  mime: Schema.String,
  name: optional(Schema.String),
}).annotate({ identifier: "Tool.FileContent" })

export const ToolContent = Schema.Union([ToolTextContent, ToolFileContent])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "LLM.ToolContent" })
export type ToolContent = Schema.Schema.Type<typeof ToolContent>
