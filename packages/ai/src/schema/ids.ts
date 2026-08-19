import { Schema } from "effect"

/** Stable string identifier for a protocol implementation. */
export const ProtocolID = Schema.String
export type ProtocolID = Schema.Schema.Type<typeof ProtocolID>

/** Stable string identifier for the runnable route. */
export const RouteID = Schema.String
export type RouteID = Schema.Schema.Type<typeof RouteID>

export const ModelID = Schema.String.pipe(Schema.brand("AI.ModelID"))
export type ModelID = typeof ModelID.Type

export const ProviderID = Schema.String.pipe(Schema.brand("AI.ProviderID"))
export type ProviderID = typeof ProviderID.Type

export const ResponseID = Schema.String
export type ResponseID = Schema.Schema.Type<typeof ResponseID>

export const ContentBlockID = Schema.String
export type ContentBlockID = Schema.Schema.Type<typeof ContentBlockID>

export const ToolCallID = Schema.String
export type ToolCallID = Schema.Schema.Type<typeof ToolCallID>
