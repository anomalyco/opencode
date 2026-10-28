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

/** Where a System One decision host reads media, from models.dev `compatibility.media_input`. */
export const MediaInput = Schema.Literals(["assets", "state", "root"]).annotate({
  identifier: "Model.MediaInput",
})
export type MediaInput = typeof MediaInput.Type

export const CacheFormat = Schema.Literals(["anthropic", "alibaba"]).annotate({ identifier: "Model.CacheFormat" })
export type CacheFormat = typeof CacheFormat.Type

export interface Compatibility extends Schema.Schema.Type<typeof Compatibility> {}
export const Compatibility = Schema.Struct({
  /** OpenAI Chat: assistant-message field that carries reasoning. Unset uses the streamed field, else `reasoning_content`. */
  reasoningField: ReasoningField.pipe(optional),
  /** OpenAI Chat: send the reasoning field on every prior assistant message, even when empty. */
  requireReasoning: Schema.Boolean.pipe(optional),
  /** OpenAI Chat: body field for the output token limit. Unset detects it from the provider. */
  maxTokensField: MaxTokensField.pipe(optional),
  /** OpenAI Chat: fail a stream that ends without `finish_reason`. Defaults to true. */
  requireFinishReason: Schema.Boolean.pipe(optional),
  /** OpenAI Chat: insert an assistant message between a tool result and the next user message. */
  requireAssistantAfterTool: Schema.Boolean.pipe(optional),
  /** OpenAI Chat, OpenAI Responses and Mistral: whether the endpoint accepts `prompt_cache_key`. */
  supportsPromptCacheKey: Schema.Boolean.pipe(optional),
  /** OpenAI Chat: request usage in the stream with `stream_options.include_usage`. Defaults to true. */
  streamUsage: Schema.Boolean.pipe(optional),
  /** Prompt-cache marker syntax the endpoint accepts. Overrides the route default; both send `cache_control`, and `alibaba` skips tool definitions. */
  cacheFormat: CacheFormat.pipe(optional),
  /** Anthropic Messages and Bedrock Converse: supports Anthropic's thinking-prefix mismatch controls. Overrides model-ID detection. */
  supportsThinkingBlockBinding: Schema.Boolean.pipe(optional),
  /** Anthropic Messages and OpenAI Responses: supports per-message effort updates. Overrides model-ID detection. */
  supportsEffortUpdates: Schema.Boolean.pipe(optional),
  /** System One: where the decision host reads media. Unset keeps the route default. */
  mediaInput: MediaInput.pipe(optional),
}).annotate({ identifier: "Model.Compatibility" })

// Provider defaults inherited by its models. Model-version features stay model-only.
export interface ProviderCompatibility extends Schema.Schema.Type<typeof ProviderCompatibility> {}
export const ProviderCompatibility = Schema.Struct(
  Struct.omit(Compatibility.fields, ["supportsThinkingBlockBinding", "supportsEffortUpdates"]),
).annotate({ identifier: "Provider.Compatibility" })
