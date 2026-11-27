import type { CacheTTL, OpenString, ReasoningEffort } from "./schema/options.js"
import { isRecord } from "./utils/record.js"

/** Tool schema sanitizer for a model family. `none` opts out of the API and model-name defaults. */
export type Sanitizer = "gemini" | "moonshot" | "none"
export type MaxTokensField = "max_completion_tokens" | "max_tokens"
/** Prompt-cache marker syntax: both send `cache_control`; `alibaba` skips tool definitions. */
export type CacheFormat = "anthropic" | "alibaba"

/**
 * What a model supports on its API, grouped by topic. Every field is tri-state: unset means unknown and falls
 * through to the next layer, while an explicit `false` is kept.
 *
 * Each API accepts a subset of these groups. `Common` holds what every chat API understands; the per-API types
 * add their own fields, so a capability the API never reads is a compile error on that API's models.
 */
export interface Common {
  readonly tools?: {
    readonly supported?: boolean
    readonly choice?: ReadonlyArray<"auto" | "none" | "required" | "tool">
    readonly search?: boolean
    /** Tool schema sanitizer for the model family. `none` opts out of the API and model-name defaults. */
    readonly sanitizer?: Sanitizer
  }
  readonly reasoning?: {
    readonly supported?: boolean
    readonly default?:
      | { readonly type: "toggle"; readonly value: boolean }
      | { readonly type: "effort"; readonly value: ReasoningEffort }
      | { readonly type: "budget"; readonly value: number }
    readonly toggle?: boolean
    readonly effort?: ReadonlyArray<ReasoningEffort>
    readonly budget?: { readonly min?: number; readonly max?: number }
    /** Accepts per-message effort updates. */
    readonly updates?: boolean
  }
  readonly cache?: false | Cache
  readonly output?: {
    readonly structured?: boolean
  }
  readonly sampling?: {
    readonly temperature?: boolean
    readonly topP?: boolean
    readonly topK?: boolean
  }
  readonly system?: {
    /** Accepts mid-conversation system messages. */
    readonly updates?: boolean
  }
  readonly serviceTier?: ReadonlyArray<OpenString<"flex" | "priority" | "fast" | "ultrafast" | "standby">>
}

export interface Cache {
  /** The endpoint reads inline cache markers, so the cache policy places them. */
  readonly markers?: boolean
  /** Where `cache: "auto"` places markers: everywhere useful (default), Qwen's system-and-tail layout, or nowhere. */
  readonly auto?: "standard" | "qwen" | "none"
  readonly implicit?: true | { readonly ttl?: ReadonlyArray<CacheTTL>; readonly minTokens?: number }
  readonly explicit?:
    | true
    | {
        readonly ttl?: ReadonlyArray<CacheTTL>
        readonly maxBreakpoints?: number
        readonly targets?: ReadonlyArray<"tools" | "system" | "messages">
        readonly minTokens?: number
      }
}

type ToolUpdates = {
  /**
   * Tool changes the model takes mid-conversation without changing the leading tool declaration, so the prompt
   * cache holds. Unset or empty: every change folds into the top-level tools.
   */
  readonly updates?: ReadonlyArray<"add" | "remove" | "replace">
}

/** OpenAI Chat Completions and its dialects. */
export interface ChatCompletions extends Common {
  readonly tools?: Common["tools"] & {
    /** Accepts `strict` on function tools. Detected from the provider when unset. */
    readonly strict?: boolean
    /** Input formats accepted by custom (free-form) tools. */
    readonly freeform?: ReadonlyArray<"text" | "lark" | "regex">
    /** Z.ai's `tool_stream` flag. */
    readonly stream?: boolean
  }
  readonly reasoning?: Common["reasoning"] & {
    /** Field the endpoint uses for assistant reasoning, such as `reasoning_content`. */
    readonly field?: string
    /** Every assistant message must include its reasoning field, even when empty. */
    readonly required?: boolean
  }
  readonly cache?: false | (Cache & ChatCache)
  readonly output?: Common["output"] & {
    readonly maxTokensField?: MaxTokensField
    /** Accepts `stream_options.include_usage`. Defaults to true. */
    readonly streamUsage?: boolean
    /** The stream must end with a finish reason. Defaults to true. */
    readonly requireFinishReason?: boolean
  }
  readonly messages?: {
    /** An assistant message must follow every tool result before the next user message. */
    readonly requireAssistantAfterTool?: boolean
  }
  /** Accepts `store`. Detected from the provider when unset. */
  readonly store?: boolean
}

type ChatCache = {
  /** Prompt-cache marker syntax the endpoint accepts; `alibaba` skips tool definitions. */
  readonly format?: CacheFormat
  /** Accepts `prompt_cache_key` in the body. Chat omits the key unless this is true. */
  readonly promptCacheKey?: boolean
}

/** OpenAI Responses and Open Responses dialects. */
export interface Responses extends Common {
  readonly tools?: Common["tools"] &
    ToolUpdates & {
      readonly freeform?: ReadonlyArray<"text" | "lark" | "regex">
    }
  readonly cache?:
    | false
    | (Cache & {
        /** Accepts `prompt_cache_key`. Omitted only when false. */
        readonly promptCacheKey?: boolean
      })
  readonly store?: boolean
  /** Compaction mechanisms the host serves. Both default to the API's support. */
  readonly compaction?: { readonly endpoint?: boolean; readonly trigger?: boolean }
}

/** Anthropic Messages and its dialects. */
export interface Messages extends Common {
  readonly tools?: Common["tools"] & ToolUpdates
  readonly reasoning?: Common["reasoning"] & {
    /** Thinking blocks must carry a signature. */
    readonly signature?: boolean
    /** Supports thinking-prefix mismatch controls. Detected from the model ID when unset. */
    readonly thinkingBlockBinding?: boolean
  }
  readonly cache?: false | (Cache & { readonly format?: CacheFormat })
}

/** Every capability any API reads. Core and other untyped sources use this; models use their API's subset. */
export interface Any extends Common {
  readonly tools?: NonNullable<ChatCompletions["tools"]> & ToolUpdates
  readonly reasoning?: NonNullable<ChatCompletions["reasoning"]> & NonNullable<Messages["reasoning"]>
  readonly cache?: false | (Cache & ChatCache)
  readonly output?: NonNullable<ChatCompletions["output"]>
  readonly messages?: ChatCompletions["messages"]
  readonly store?: boolean
  readonly compaction?: Responses["compaction"]
}

/** The cache capabilities, or undefined when unknown or the model doesn't cache. */
export const cache = (caps: Any | undefined) => (caps?.cache === false ? undefined : caps?.cache)

/** An API's capability defaults, typed by the capability subset it reads. */
export const defaults = <Caps extends Any>(value?: Caps): Caps | undefined => value

/**
 * Merge capability layers; later layers win per field. Unset fields fall through, explicit `false` is kept, and
 * arrays are replaced whole.
 */
export const merge = <Caps extends Any>(...layers: ReadonlyArray<Caps | undefined>): Caps | undefined =>
  layers.reduce<unknown>((result, layer) => mergeValue(result, layer), undefined) as Caps | undefined

// Unset fields and empty groups drop out, so a layer of all-unset fields changes nothing.
const mergeValue = (base: unknown, next: unknown): unknown => {
  if (next === undefined) return base
  if (!isRecord(next)) return next
  const from = isRecord(base) ? base : {}
  const entries = [...new Set([...Object.keys(from), ...Object.keys(next)])].flatMap((key) => {
    const value = mergeValue(from[key], next[key])
    return value === undefined ? [] : [[key, value] as const]
  })
  return entries.length === 0 ? base : Object.fromEntries(entries)
}

export * as Capabilities from "./capabilities.js"
