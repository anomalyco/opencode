export * as OpenRouterWire from "./openrouter.js"

import { Effect, Option, Schema } from "effect"
import { LLMRequest, Message, type ContentPart, type ReasoningPart } from "../../schema/index.js"
import { OpenAIResponses } from "../openai-responses.js"
import { AnthropicMessages } from "../anthropic-messages.js"
import { isRecord, ProviderShared } from "../shared.js"

const ReplayDetail = Schema.Struct({
  type: Schema.String,
  text: Schema.optional(Schema.String),
  signature: Schema.optional(Schema.NullOr(Schema.String)),
  data: Schema.optional(Schema.String),
  encrypted: Schema.optional(Schema.String),
})
const decodeReplayDetail = Schema.decodeUnknownOption(ReplayDetail)

export const responses = Effect.fn("OpenRouter.responses")(function* (request: LLMRequest) {
  const { usage: _, ...options } = bodyOptions(request.providerOptions, request.generation?.maxTokens)
  const body = yield* OpenAIResponses.protocol.body.from(
    LLMRequest.update(request, {
      providerOptions: {
        ...request.providerOptions,
        reasoningEffort: request.providerOptions?.reasoningEffort ?? options.reasoning?.effort,
      },
      messages: replayMessages(request, "responses"),
    }),
  )
  return {
    ...options,
    ...body,
    store: false as const,
    // The shared lowerer owns the chronological effort baseline, including the model default.
    ...(options.reasoning || body.reasoning
      ? {
          reasoning: {
            ...options.reasoning,
            ...body.reasoning,
            effort: body.reasoning?.effort,
            summary: body.reasoning?.summary ?? options.reasoning?.summary,
          },
        }
      : {}),
    ...(options.text || body.text ? { text: { ...options.text, ...body.text } } : {}),
  }
})

export const messages = Effect.fn("OpenRouter.messages")(function* (request: LLMRequest) {
  const { reasoning, usage: _, ...options } = bodyOptions(request.providerOptions, request.generation?.maxTokens)
  const disabled = reasoning?.enabled === false || reasoning?.effort === "none"
  const body = yield* AnthropicMessages.protocol.body.from(
    LLMRequest.update(request, {
      providerOptions: {
        ...request.providerOptions,
        effort:
          request.providerOptions?.effort ??
          (!disabled && typeof reasoning?.effort === "string" ? reasoning.effort : undefined),
        thinking:
          request.providerOptions?.thinking ??
          (() => {
            if (disabled) return { type: "disabled" }
            if (typeof reasoning?.max_tokens === "number")
              return { type: "enabled", budget_tokens: reasoning.max_tokens }
            if (reasoning?.enabled === true || typeof reasoning?.effort === "string")
              return { type: "adaptive", ...(reasoning.exclude === true ? { display: "omitted" } : {}) }
          })(),
      },
      messages: replayMessages(request, "messages"),
    }),
  )
  return { ...options, ...body }
})

function replayMessages(request: LLMRequest, format: "responses" | "messages") {
  return request.messages.map((message) =>
    message.role !== "assistant"
      ? message
      : Message.make({
          ...message,
          content: message.content.flatMap<ContentPart>((part) =>
            part.type === "reasoning" ? replayReasoning(part, format) : [part],
          ),
        }),
  )
}

// Existing Chat histories store signatures in reasoning_details, not native block/item metadata.
function replayReasoning(part: ReasoningPart, format: "responses" | "messages"): ReasoningPart[] {
  const metadata = part.providerMetadata?.openrouter
  if (!Array.isArray(metadata?.reasoningDetails)) return [part]
  const details = metadata.reasoningDetails.flatMap((detail) => Option.toArray(decodeReplayDetail(detail)))
  const withMetadata = (extra: Record<string, unknown>, text = part.text): ReasoningPart => ({
    ...part,
    text,
    providerMetadata: { ...part.providerMetadata, openrouter: { ...metadata, ...extra } },
  })
  if (format === "responses") {
    const encrypted = details.find((detail) => detail.type === "reasoning.encrypted" || detail.type === "encrypted")
    return [
      withMetadata({
        reasoningEncryptedContent: metadata.reasoningEncryptedContent ?? encrypted?.data ?? encrypted?.encrypted,
      }),
    ]
  }
  const blocks = details.flatMap<ReasoningPart>((detail) => {
    if (detail.type === "reasoning.text" && detail.signature)
      return [withMetadata({ signature: detail.signature }, detail.text ?? part.text)]
    if (detail.type === "reasoning.encrypted" && detail.data) return [withMetadata({ redactedData: detail.data }, "")]
    return []
  })
  return blocks.length ? blocks : [part]
}

export const bodyOptions = (input: LLMRequest["providerOptions"], maxTokens: number | undefined) => {
  const {
    usage,
    models,
    provider,
    plugins,
    web_search_options,
    debug,
    user,
    reasoning,
    text,
    promptCacheKey,
    ...options
  } = input ?? {}
  return {
    ...options,
    ...(usage === undefined || usage === true
      ? { usage: { include: true } }
      : usage === false
        ? { usage: { include: false } }
        : isRecord(usage)
          ? { usage }
          : {}),
    ...(Array.isArray(models) ? { models } : {}),
    ...(isRecord(provider) ? { provider } : {}),
    ...(Array.isArray(plugins) ? { plugins } : {}),
    ...(isRecord(web_search_options) ? { web_search_options } : {}),
    ...(isRecord(debug) ? { debug } : {}),
    ...(typeof user === "string" ? { user } : {}),
    ...(isRecord(reasoning) ? { reasoning: fitReasoning(reasoning, maxTokens) } : {}),
    ...(isRecord(text) ? { text } : {}),
  }
}

// Anthropic and Alibaba require the thinking budget to remain below the output limit.
function fitReasoning(reasoning: Record<string, unknown>, maxTokens: number | undefined) {
  return typeof reasoning.max_tokens === "number"
    ? { ...reasoning, max_tokens: ProviderShared.fitThinkingBudget(reasoning.max_tokens, maxTokens, 1_024) }
    : reasoning
}
