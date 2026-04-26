import * as LLMCore from "@opencode-ai/llm/llm"
import type { Message as CoreMessage } from "@opencode-ai/llm/schema"
import { Effect, Schema } from "effect"
import { ProviderLLMBridge } from "@/provider/llm-bridge"
import type { Provider } from "@/provider"
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
  readonly generation?: LLMCore.RequestInput["generation"]
  readonly metadata?: Record<string, unknown>
  readonly native?: Record<string, unknown>
}

const isDefined = <T>(value: T | undefined): value is T => value !== undefined

const textContent = (message: MessageV2.WithParts) =>
  message.parts.flatMap((part) => (part.type === "text" && !part.ignored ? [LLMCore.text(part.text)] : []))

const message = (input: MessageV2.WithParts): CoreMessage | undefined => {
  const content = textContent(input)
  if (content.length === 0) return undefined
  return LLMCore.message({
    id: input.info.id,
    role: input.info.role,
    content,
    native: {
      opencodeMessageID: input.info.id,
    },
  })
}

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
    messages: input.messages.map(message).filter(isDefined),
    tools: [],
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
