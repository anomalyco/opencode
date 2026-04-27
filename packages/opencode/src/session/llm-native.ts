import * as LLMCore from "@opencode-ai/llm/llm"
import type { ContentPart, Message as CoreMessage } from "@opencode-ai/llm/schema"
import { Effect, Schema } from "effect"
import { ProviderLLMBridge } from "@/provider/llm-bridge"
import { ProviderTransform } from "@/provider"
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

export type RequestInput = {
  readonly id?: string
  readonly provider: Provider.Info
  readonly model: Provider.Model
  readonly system?: ReadonlyArray<string>
  readonly messages: ReadonlyArray<MessageV2.WithParts>
  readonly tools?: ReadonlyArray<Tool.Def>
  readonly toolChoice?: LLMCore.RequestInput["toolChoice"]
  readonly generation?: LLMCore.RequestInput["generation"]
  readonly metadata?: Record<string, unknown>
  readonly native?: Record<string, unknown>
}

const isDefined = <T>(value: T | undefined): value is T => value !== undefined

const textContent = (message: MessageV2.WithParts) =>
  message.parts.flatMap((part) => (part.type === "text" && !part.ignored ? [LLMCore.text(part.text)] : []))

const providerMeta = (metadata: Record<string, unknown> | undefined) => {
  if (!metadata) return undefined
  const { providerExecuted: _, ...rest } = metadata
  return Object.keys(rest).length > 0 ? rest : undefined
}

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

const assistantMessages = (input: MessageV2.WithParts) => {
  const content: ContentPart[] = []
  const results: CoreMessage[] = []
  for (const part of input.parts) {
    if (part.type === "text" && !part.ignored) content.push(LLMCore.text(part.text))
    if (part.type === "reasoning") content.push({ type: "reasoning", text: part.text, metadata: part.metadata })
    if (part.type === "tool") {
      const metadata = providerMeta(part.metadata)
      content.push(
        LLMCore.toolCall({
          id: part.callID,
          name: part.tool,
          input: part.state.input,
          providerExecuted: part.metadata?.providerExecuted === true ? true : undefined,
          metadata,
        }),
      )
      results.push(
        LLMCore.toolMessage({
          id: part.callID,
          name: part.tool,
          result: toolResultValue(part),
          providerExecuted: part.metadata?.providerExecuted === true ? true : undefined,
          metadata,
        }),
      )
    }
  }

  return [
    content.length === 0
      ? undefined
      : LLMCore.message({
          id: input.info.id,
          role: "assistant",
          content,
          native: {
            opencodeMessageID: input.info.id,
          },
        }),
    ...results,
  ].filter(isDefined)
}

const message = (input: MessageV2.WithParts): ReadonlyArray<CoreMessage> => {
  if (input.info.role === "assistant") return assistantMessages(input)

  const content = textContent(input)
  if (content.length === 0) return []
  return [LLMCore.message({
    id: input.info.id,
    role: input.info.role,
    content,
    native: {
      opencodeMessageID: input.info.id,
    },
  })]
}

export const toolDefinition = (input: { readonly model: Provider.Model; readonly tool: Tool.Def }) =>
  LLMCore.tool({
    name: input.tool.id,
    description: input.tool.description,
    inputSchema: Object.fromEntries(
      Object.entries(ProviderTransform.schema(input.model, EffectZod.toJsonSchema(input.tool.parameters))),
    ),
    native: {
      opencodeToolID: input.tool.id,
    },
  })

export const request = Effect.fn("LLMNative.request")(function* (input: RequestInput) {
  const model = ProviderLLMBridge.toModelRef({ provider: input.provider, model: input.model })
  if (!model) {
    return yield* new UnsupportedModelError({
      providerID: input.provider.id,
      modelID: input.model.id,
    })
  }

  return LLMCore.request({
    id: input.id,
    model,
    system: input.system?.filter((part) => part.trim() !== "").map(LLMCore.system) ?? [],
    messages: input.messages.flatMap(message),
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
