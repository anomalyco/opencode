export * as ToolPayload from "./tool-payload.js"

import { Schema } from "effect"
import { ToolContent } from "./llm.js"
import { optional } from "./schema.js"

/** SHA-256 hex of the canonical JSON tool payload body. */
export const Hash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)).pipe(Schema.brand("ToolPayload.Hash"))
export type Hash = typeof Hash.Type

/** Full tool settlement bytes stored beside the durable event log. */
export const Body = Schema.Struct({
  structured: Schema.Record(Schema.String, Schema.Unknown),
  content: Schema.Array(ToolContent),
  result: Schema.Unknown.pipe(optional),
}).annotate({ identifier: "ToolPayload.Body" })
export type Body = typeof Body.Type
