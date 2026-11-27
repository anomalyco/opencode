import {
  LanguageModelCompatibility,
  type CacheTTL,
  type Capabilities,
  type LanguageModelCacheFormatCompatibility,
  type LanguageModelMaxTokensFieldCompatibility,
  type LanguageModelSanitizerCompatibility,
  type OpenString,
  type ReasoningEffort,
} from "./schema/options.js"
import { isRecord } from "./utils/record.js"

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
    readonly sanitizer?: LanguageModelSanitizerCompatibility
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
    readonly maxTokensField?: LanguageModelMaxTokensFieldCompatibility
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
  readonly format?: LanguageModelCacheFormatCompatibility
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
  readonly cache?: false | (Cache & { readonly format?: LanguageModelCacheFormatCompatibility })
}

/** Every capability any API reads. Core and other untyped sources use this; models use their API's subset. */
export interface Any extends Common {
  readonly tools?: NonNullable<ChatCompletions["tools"]> & ToolUpdates
  readonly reasoning?: NonNullable<ChatCompletions["reasoning"]> & NonNullable<Messages["reasoning"]>
  readonly cache?: false | (Cache & ChatCache)
  readonly output?: NonNullable<ChatCompletions["output"]>
  readonly messages?: ChatCompletions["messages"]
  readonly store?: boolean
}

/** An API's capability defaults, typed by the capability subset it reads. */
export const defaults = <Caps extends Any>(value?: Caps): Caps | undefined => value

/**
 * Merge capability layers; later layers win per field. Unset fields fall through, explicit `false` is kept, and
 * arrays are replaced whole.
 */
export const merge = <Caps extends Any>(...layers: ReadonlyArray<Caps | undefined>): Caps | undefined => {
  const defined = layers.filter((layer) => layer !== undefined)
  if (defined.length === 0) return undefined
  if (defined.length === 1) return defined[0]
  return defined.reduce((result, layer) => mergeValue(result, layer) as Caps)
}

const mergeValue = (base: unknown, next: unknown): unknown => {
  if (next === undefined) return base
  if (!isRecord(base) || !isRecord(next)) return next
  return Object.fromEntries(
    [...new Set([...Object.keys(base), ...Object.keys(next)])].flatMap((key) => {
      const value = mergeValue(base[key], next[key])
      return value === undefined ? [] : [[key, value]]
    }),
  )
}

/** The model fields today's request builders read. Removed once every API reads the merged record directly. */
export interface Projection {
  readonly capabilities?: Capabilities
  readonly compatibility?: LanguageModelCompatibility
}

export const project = (caps: Any | undefined): Projection => {
  if (caps === undefined) return {}
  const cache = caps.cache === false ? undefined : caps.cache
  const capabilities = compact<Capabilities>({
    tools: compact({
      supported: caps.tools?.supported,
      strict: caps.tools?.strict,
      choice: caps.tools?.choice,
      search: caps.tools?.search,
      freeform: caps.tools?.freeform,
      updates: caps.tools?.updates,
    }),
    reasoning: compact({
      supported: caps.reasoning?.supported,
      default: caps.reasoning?.default,
      toggle: caps.reasoning?.toggle,
      effort: caps.reasoning?.effort,
      budget: caps.reasoning?.budget,
      updates: caps.reasoning?.updates,
    }),
    cache: caps.cache === false ? false : compact({ implicit: cache?.implicit, explicit: cache?.explicit }),
    structuredOutput: caps.output?.structured,
    temperature: caps.sampling?.temperature,
    topP: caps.sampling?.topP,
    topK: caps.sampling?.topK,
    systemUpdates: caps.system?.updates,
    store: caps.store,
    streamUsage: caps.output?.streamUsage,
    promptCacheKey: cache?.promptCacheKey,
    serviceTier: caps.serviceTier,
  })
  const compatibility = compact<NonNullable<ConstructorParameters<typeof LanguageModelCompatibility>[0]>>({
    sanitizer: caps.tools?.sanitizer,
    reasoningField: caps.reasoning?.field,
    requireReasoning: caps.reasoning?.required,
    maxTokensField: caps.output?.maxTokensField,
    requireFinishReason: caps.output?.requireFinishReason,
    requireAssistantAfterTool: caps.messages?.requireAssistantAfterTool,
    cacheFormat: cache?.format,
    zaiToolStream: caps.tools?.stream,
    requireSignature: caps.reasoning?.signature,
    supportsThinkingBlockBinding: caps.reasoning?.thinkingBlockBinding,
  })
  return {
    ...(capabilities === undefined ? {} : { capabilities }),
    ...(compatibility === undefined ? {} : { compatibility: LanguageModelCompatibility.make(compatibility) }),
  }
}

/** Read today's split capabilities and compatibility records as one capabilities record. */
export const fromProjection = (input: {
  readonly capabilities?: Capabilities
  readonly compatibility?: LanguageModelCompatibility.Input
}): Any | undefined => {
  const legacy = input.capabilities
  const compat = input.compatibility
  const cache =
    legacy?.cache === false
      ? false
      : compact<Cache & ChatCache>({
          implicit: legacy?.cache?.implicit,
          explicit: legacy?.cache?.explicit,
          format: compat?.cacheFormat,
          promptCacheKey: legacy?.promptCacheKey,
        })
  return compact<Any>({
    tools: compact({ ...legacy?.tools, sanitizer: compat?.sanitizer, stream: compat?.zaiToolStream }),
    reasoning: compact({
      ...legacy?.reasoning,
      field: compat?.reasoningField,
      required: compat?.requireReasoning,
      signature: compat?.requireSignature,
      thinkingBlockBinding: compat?.supportsThinkingBlockBinding,
    }),
    cache,
    output: compact({
      structured: legacy?.structuredOutput,
      maxTokensField: compat?.maxTokensField,
      streamUsage: legacy?.streamUsage,
      requireFinishReason: compat?.requireFinishReason,
    }),
    sampling: compact({ temperature: legacy?.temperature, topP: legacy?.topP, topK: legacy?.topK }),
    system: compact({ updates: legacy?.systemUpdates }),
    messages: compact({ requireAssistantAfterTool: compat?.requireAssistantAfterTool }),
    store: legacy?.store,
    serviceTier: legacy?.serviceTier,
  })
}

const compact = <A extends object>(value: A): A | undefined => {
  const entries = Object.entries(value).filter((entry) => entry[1] !== undefined)
  return entries.length === 0 ? undefined : (Object.fromEntries(entries) as A)
}

export * as Capabilities from "./capabilities.js"
