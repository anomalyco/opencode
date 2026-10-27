import { Schema, Struct } from "effect"
import { optional } from "./schema.js"

// Shared by model and provider schemas; kept separate because model.ts imports provider.ts.
export type ReasoningField = "reasoning" | "reasoning_content" | "reasoning_text" | (string & {})
export const ReasoningField: Schema.Codec<ReasoningField> = Schema.Union([
  Schema.Literals(["reasoning", "reasoning_content", "reasoning_text"]),
  Schema.String,
]).annotate({ identifier: "Model.ReasoningField" })

export const MaxTokensField = Schema.Literals(["max_completion_tokens", "max_tokens"]).annotate({
  identifier: "Model.MaxTokensField",
})
export type MaxTokensField = typeof MaxTokensField.Type

export const CacheFormat = Schema.Literals(["anthropic", "alibaba"]).annotate({ identifier: "Model.CacheFormat" })
export type CacheFormat = typeof CacheFormat.Type

export interface Compatibility extends Schema.Schema.Type<typeof Compatibility> {}
export const Compatibility = Schema.Struct({
  reasoningField: ReasoningField.pipe(optional),
  /** Require every assistant message to include its reasoning field, even when empty. */
  requireReasoning: Schema.Boolean.pipe(optional),
  maxTokensField: MaxTokensField.pipe(optional),
  requireFinishReason: Schema.Boolean.pipe(optional),
  requireAssistantAfterTool: Schema.Boolean.pipe(optional),
  supportsPromptCacheKey: Schema.Boolean.pipe(optional),
  /** Request usage in the stream with `stream_options.include_usage`. Defaults to true. */
  streamUsage: Schema.Boolean.pipe(optional),
  /** Prompt-cache marker syntax the endpoint accepts. Overrides the route default; both send `cache_control`, and `alibaba` skips tool definitions. */
  cacheFormat: CacheFormat.pipe(optional),
  /** Supports Anthropic's thinking-prefix mismatch controls. Overrides model-ID detection. */
  supportsThinkingBlockBinding: Schema.Boolean.pipe(optional),
  /** Supports per-message effort updates. Overrides model-ID detection. */
  supportsEffortUpdates: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "Model.Compatibility" })

// Provider defaults inherited by its models. Model-version features stay model-only.
export interface ProviderCompatibility extends Schema.Schema.Type<typeof ProviderCompatibility> {}
export const ProviderCompatibility = Schema.Struct(
  Struct.omit(Compatibility.fields, ["supportsThinkingBlockBinding", "supportsEffortUpdates"]),
).annotate({ identifier: "Provider.Compatibility" })
