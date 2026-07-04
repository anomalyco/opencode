import { Schema } from "effect"
import { LLM, ProviderMetadata } from "@opencode-ai/schema/llm"

export { ProviderMetadata }

/** Stable string identifier for a protocol implementation. */
export const ProtocolID = Schema.String
export type ProtocolID = Schema.Schema.Type<typeof ProtocolID>

/** Stable string identifier for the runnable route. */
export const RouteID = Schema.String
export type RouteID = Schema.Schema.Type<typeof RouteID>

export const ModelID = Schema.String.pipe(Schema.brand("LLM.ModelID"))
export type ModelID = typeof ModelID.Type

export const ProviderID = Schema.String.pipe(Schema.brand("LLM.ProviderID"))
export type ProviderID = typeof ProviderID.Type

export const ResponseID = Schema.String
export type ResponseID = Schema.Schema.Type<typeof ResponseID>

export const ContentBlockID = Schema.String
export type ContentBlockID = Schema.Schema.Type<typeof ContentBlockID>

export const ToolCallID = Schema.String
export type ToolCallID = Schema.Schema.Type<typeof ToolCallID>

export const ReasoningEfforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const
export const ReasoningEffort = Schema.String
export type ReasoningEffort = Schema.Schema.Type<typeof ReasoningEffort>

export const TextVerbosity = Schema.Literals(["low", "medium", "high"])
export type TextVerbosity = Schema.Schema.Type<typeof TextVerbosity>

export const MessageRole = Schema.Literals(["system", "user", "assistant", "tool"])
export type MessageRole = Schema.Schema.Type<typeof MessageRole>

export const FinishReason = LLM.FinishReason
export type FinishReason = Schema.Schema.Type<typeof FinishReason>

export const JsonSchema = Schema.Record(Schema.String, Schema.Unknown)
export type JsonSchema = Schema.Schema.Type<typeof JsonSchema>
