import { LLM, type ContentPart, type Message as CoreMessage } from "@opencode-ai/llm"
import { Effect, Schema } from "effect"
import { ProviderLLMBridge } from "@/provider/llm-bridge"
import * as EffectZod from "@/util/effect-zod"
import type { Provider } from "@/provider"
import type { Tool } from "@/tool"
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
  },
) {
  override get message() {
    return `Native LLM request conversion does not support ${this.partType} parts in message ${this.messageID}`
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
  readonly metadata?: Record<string, unknown>
  readonly native?: Record<string, unknown>
}

const isDefined = <T>(value: T | undefined): value is T => value !== undefined

const textContent = (message: MessageV2.WithParts) =>
  message.parts.flatMap((part) => (part.type === "text" && !part.ignored ? [LLM.text(part.text)] : []))

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

const isToolPart = (part: MessageV2.Part): part is MessageV2.ToolPart => part.type === "tool"

const supportsPart = (message: MessageV2.WithParts, part: MessageV2.Part) => {
  if (part.type === "text") return true
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
  if (part.type === "reasoning") return [{ type: "reasoning", text: part.text, metadata: part.metadata }]
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

const userMessage = (input: MessageV2.WithParts): ReadonlyArray<CoreMessage> => {
  const content = textContent(input)
  if (content.length === 0) return []
  return [
    LLM.message({
      id: input.info.id,
      role: input.info.role,
      content,
      native: nativeMessage(input),
    }),
  ]
}

const messages = (input: MessageV2.WithParts): ReadonlyArray<CoreMessage> => {
  if (input.info.role === "assistant") return assistantMessages(input)
  return userMessage(input)
}

export const toolDefinition = (input: { readonly model: Provider.Model; readonly tool: Tool.Def }) =>
  LLM.toolDefinition({
    name: input.tool.id,
    description: input.tool.description,
    inputSchema: EffectZod.toJsonSchema(input.tool.parameters),
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

  return LLM.request({
    id: input.id,
    model,
    system: input.system?.filter((part) => part.trim() !== "").map(LLM.system) ?? [],
    messages: input.messages.flatMap(messages),
    tools: input.tools?.map((tool) => toolDefinition({ model: input.model, tool })) ?? [],
    toolChoice: input.toolChoice,
    generation: input.generation,
    metadata: input.metadata,
    native: {
      opencodeProviderID: input.provider.id,
      opencodeModelID: input.model.id,
      ...input.native,
    },
  })
})

export * as LLMNative from "./llm-native"
