import { CacheHint, LLM, type ContentPart, type MediaPart, type Message, type ModelRef, type SystemPart } from "@opencode-ai/llm"
import { Effect, Schema } from "effect"
import { ProviderLLMBridge } from "@/provider/llm-bridge"
import { ProviderTransform } from "@/provider/transform"
import * as EffectZod from "@/util/effect-zod"
import type { Provider } from "@/provider/provider"
import type { Tool } from "@/tool/tool"
import type { MessageV2 } from "./message-v2"

export class UnsupportedModelError extends Schema.TaggedErrorClass<UnsupportedModelError>()(
  "LLMNative.UnsupportedModelError",
  {
    providerID: Schema.String,
    modelID: Schema.String,
  },
) {
  override get message() {
    return `No native LLM route for ${this.providerID}/${this.modelID}`
  }
}

export class UnsupportedContentError extends Schema.TaggedErrorClass<UnsupportedContentError>()(
  "LLMNative.UnsupportedContentError",
  {
    messageID: Schema.String,
    partType: Schema.String,
    reason: Schema.optional(Schema.String),
  },
) {
  override get message() {
    const base = `Native LLM request conversion does not support ${this.partType} parts in message ${this.messageID}`
    return this.reason ? `${base}: ${this.reason}` : base
  }
}

export type RequestInput = {
  readonly id?: string
  readonly provider: Provider.Info
  readonly model: Provider.Model
  readonly system?: ReadonlyArray<string>
  readonly messages: ReadonlyArray<MessageV2.WithParts>
  readonly tools?: ReadonlyArray<Tool.Def>
  readonly toolChoice?: LLM.RequestInput["toolChoice"]
  readonly generation?: LLM.RequestInput["generation"]
  readonly headers?: Record<string, string>
  readonly metadata?: Record<string, unknown>
}

const isDefined = <T>(value: T | undefined): value is T => value !== undefined

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// Match `data:<mediaType>[;param=value]*[;base64],<payload>`. Captures only the
// payload — the bridge passes it through to `MediaPart.data` (already-base64
// per the convention `ProviderShared.mediaBytes` follows). Non-data URLs
// (http(s):, file:, relative paths) are out of scope for now and rejected
// upstream so a future fetch / filesystem-read path can plug in cleanly.
const DATA_URL_PATTERN = /^data:[^,]*,(.*)$/s

const lowerFilePart = (message: MessageV2.WithParts, part: MessageV2.FilePart) =>
  Effect.gen(function* () {
    const match = DATA_URL_PATTERN.exec(part.url)
    if (!match) {
      return yield* new UnsupportedContentError({
        messageID: message.info.id,
        partType: "file",
        reason: `file URL must be a data: URL (got ${part.url})`,
      })
    }
    return {
      type: "media",
      mediaType: part.mime,
      data: match[1],
      filename: part.filename,
    } satisfies MediaPart
  })

const nativeMessage = (message: MessageV2.WithParts) => ({
  opencodeMessageID: message.info.id,
})

const providerMeta = (metadata: Record<string, unknown> | undefined) => {
  if (!metadata) return undefined
  const { providerExecuted: _, ...rest } = metadata
  return Object.keys(rest).length > 0 ? rest : undefined
}

const providerExecuted = (metadata: Record<string, unknown> | undefined) =>
  metadata?.providerExecuted === true ? true : undefined

const encryptedReasoning = (metadata: Record<string, unknown> | undefined) => {
  if (!metadata) return undefined
  if (typeof metadata.encrypted === "string") return metadata.encrypted
  if (isRecord(metadata.anthropic) && typeof metadata.anthropic.signature === "string") return metadata.anthropic.signature
  if (isRecord(metadata.openai) && typeof metadata.openai.reasoningEncryptedContent === "string") {
    return metadata.openai.reasoningEncryptedContent
  }
  return undefined
}

const isToolPart = (part: MessageV2.Part): part is MessageV2.ToolPart => part.type === "tool"

const EPHEMERAL_CACHE = new CacheHint({ type: "ephemeral" })

const supportsPart = (message: MessageV2.WithParts, part: MessageV2.Part) => {
  if (part.type === "text") return true
  if (part.type === "file") return message.info.role === "user"
  if (message.info.role !== "assistant") return false
  return part.type === "reasoning" || part.type === "tool"
}

const unsupportedPart = (input: RequestInput) =>
  input.messages
    .flatMap((message) => message.parts.map((part) => ({ message, part })))
    .find((entry) => !supportsPart(entry.message, entry.part))

const toolResultValue = (part: MessageV2.ToolPart) => {
  if (part.state.status === "completed") {
    return {
      type: "text" as const,
      value: part.state.time.compacted ? "[Old tool result content cleared]" : part.state.output,
    }
  }
  if (part.state.status === "error") {
    const output = part.state.metadata?.interrupted === true ? part.state.metadata.output : undefined
    if (typeof output === "string") return { type: "text" as const, value: output }
    return { type: "error" as const, value: part.state.error }
  }
  return { type: "error" as const, value: "[Tool execution was interrupted]" }
}

const assistantContent = (part: MessageV2.Part): ReadonlyArray<ContentPart> => {
  if (part.type === "text" && !part.ignored) return [LLM.text(part.text)]
  if (part.type === "reasoning") return [{ type: "reasoning", text: part.text, encrypted: encryptedReasoning(part.metadata), metadata: part.metadata }]
  if (part.type !== "tool") return []

  return [
    LLM.toolCall({
      id: part.callID,
      name: part.tool,
      input: part.state.input,
      providerExecuted: providerExecuted(part.metadata),
      metadata: providerMeta(part.metadata),
    }),
    ...(providerExecuted(part.metadata) ? [toolResultPart(part)] : []),
  ]
}

const toolResultMessage = (part: MessageV2.ToolPart) =>
  LLM.toolMessage({
    id: part.callID,
    name: part.tool,
    result: toolResultValue(part),
    providerExecuted: providerExecuted(part.metadata),
    metadata: providerMeta(part.metadata),
  })

const toolResultPart = (part: MessageV2.ToolPart) =>
  LLM.toolResult({
    id: part.callID,
    name: part.tool,
    result: toolResultValue(part),
    providerExecuted: true,
    metadata: providerMeta(part.metadata),
  })

const assistantMessages = (input: MessageV2.WithParts) => {
  const content = input.parts.flatMap(assistantContent)
  const assistant = content.length
    ? LLM.message({
        id: input.info.id,
        role: "assistant",
        content,
        native: nativeMessage(input),
      })
    : undefined

  return [
    assistant,
    ...input.parts.filter(isToolPart).filter((part) => !providerExecuted(part.metadata)).map(toolResultMessage),
  ].filter(isDefined)
}

const cacheLastText = (content: ReadonlyArray<ContentPart>): ReadonlyArray<ContentPart> => {
  const last = content.findLastIndex((part) => part.type === "text")
  if (last === -1) return content
  return content.map((part, index) => index === last && part.type === "text" ? { ...part, cache: EPHEMERAL_CACHE } : part)
}

const cacheHints = (input: {
  readonly model: ModelRef
  readonly system: ReadonlyArray<SystemPart>
  readonly messages: ReadonlyArray<Message>
}) => {
  if (!input.model.capabilities.cache.prompt) return input
  return {
    model: input.model,
    system: input.system.map((part, index) => index < 2 ? { ...part, cache: EPHEMERAL_CACHE } : part),
    messages: input.messages.map((message, index) =>
      index < input.messages.length - 2 ? message : LLM.message({ ...message, content: cacheLastText(message.content) }),
    ),
  }
}

// User-role parts that pass the static gate: text and file. Text becomes a
// `LLM.text(...)` ContentPart; file becomes a `MediaPart` via `lowerFilePart`,
// which can yield `UnsupportedContentError` for non-data URLs.
const lowerUserPart = (message: MessageV2.WithParts, part: MessageV2.Part) =>
  Effect.gen(function* () {
    if (part.type === "text") return part.ignored ? [] : [LLM.text(part.text)]
    if (part.type === "file") return [yield* lowerFilePart(message, part)]
    return []
  })

const userMessage = Effect.fnUntraced(function* (input: MessageV2.WithParts) {
  const content: ContentPart[] = []
  for (const part of input.parts) {
    content.push(...(yield* lowerUserPart(input, part)))
  }
  if (content.length === 0) return []
  return [
    LLM.message({
      id: input.info.id,
      role: input.info.role,
      content,
      native: nativeMessage(input),
    }),
  ]
})

const lowerMessage = Effect.fnUntraced(function* (input: MessageV2.WithParts) {
  if (input.info.role === "assistant") return assistantMessages(input)
  return yield* userMessage(input)
})

export const toolDefinition = (input: { readonly model: Provider.Model; readonly tool: Tool.Def }) =>
  LLM.toolDefinition({
    name: input.tool.id,
    description: input.tool.description,
    inputSchema: { ...ProviderTransform.schema(input.model, EffectZod.toJsonSchema(input.tool.parameters)) },
    native: {
      opencodeToolID: input.tool.id,
    },
  })

export const request = Effect.fn("LLMNative.request")(function* (input: RequestInput) {
  const unsupported = unsupportedPart(input)
  if (unsupported) {
    return yield* new UnsupportedContentError({
      messageID: unsupported.message.info.id,
      partType: unsupported.part.type,
    })
  }

  const model = ProviderLLMBridge.toModelRef({ provider: input.provider, model: input.model })
  if (!model) {
    return yield* new UnsupportedModelError({
      providerID: input.provider.id,
      modelID: input.model.id,
    })
  }
  const headers = { ...model.headers, ...input.headers }
  const requestModel = Object.keys(headers).length === 0 ? model : LLM.model({ ...model, headers })
  const cached = cacheHints({
    model: requestModel,
    system: input.system?.filter((part) => part.trim() !== "").map(LLM.system) ?? [],
    messages: (yield* Effect.forEach(input.messages, lowerMessage)).flat(),
  })

  // Keep this bridge focused on shape conversion. Provider-specific policy and
  // quirks should live on model policy, provider facades, or protocol lowering.
  return LLM.request({
    id: input.id,
    model: cached.model,
    system: cached.system,
    messages: cached.messages,
    tools: input.tools?.map((tool) => toolDefinition({ model: input.model, tool })) ?? [],
    toolChoice: input.toolChoice,
    generation: input.generation,
    metadata: input.metadata,
  })
})

export * as LLMNative from "./llm-native"
